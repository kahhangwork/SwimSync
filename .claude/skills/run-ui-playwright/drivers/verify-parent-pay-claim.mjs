// verify-parent-pay-claim.mjs — Pay and claim from the parent's invoice LIST.
//
// WHY THIS EXISTS. Until 2026-08-08 both controls lived only inside the invoice
// DETAIL screen, two taps behind "View Details" — while the public tokenized
// page the WhatsApp reminder links to put them in front of the parent
// immediately. The parent who bothered to open the APP got the slower path.
// This proves the list-card controls work and, more importantly, that they do
// not fire the card's own navigation.
//
// ⚠ WHAT THE "one dialog / URL did not move" CHECKS DO **NOT** PROVE.
// They were written to guard a predicted double-fire: `confirmAction` is a
// synchronous, blocking `window.confirm` on RN-web (SwimSyncApp/lib/confirm.ts),
// so a claim press that ALSO bubbled to the card-wide TouchableOpacity would
// run the RPC and then navigate. That prediction was tested on 2026-08-08 by
// deliberately nesting the action row back inside the card's touchable and
// re-running this driver: it still scored 16/16. React Native's responder
// system grants the responder to the INNERMOST view and does not propagate to
// ancestor Touchables, so nested presses do not double-fire.
//
// So those two checks are kept as cheap OUTCOME guards — a claim must not
// navigate, however that might come about — but they are NOT the reason the
// card is laid out with the action row as a sibling of the touchable, and they
// will NOT go red if someone nests it again. Do not cite them as that guard.
// (§7.25: a check that cannot fail is not coverage. These can fail — just not
// from nesting.)
//
// NOT proven here: the QR itself (verify-payment-collection.mjs owns that), or
// the admin-side confirm loop.
//
// Setup:
//   docker exec -i supabase_db_SwimSync psql -U postgres -d postgres \
//     < .claude/skills/run-ui-playwright/drivers/fixtures-payment-collection.sql
//   Expo web on :8081.  (No admin server and no edge function needed — this
//   driver never leaves the app.)
//
// Reuses fixtures-payment-collection.sql: it already creates
// pay-driver-parent@swimsync.test holding INV-2026-9901 at $88.00, outstanding
// and unclaimed. run-all-drivers.sh maps it via fixture_for().

import { EXPO, launch, loginExpo, tap, visibleText } from "./lib.mjs";

const results = [];
const check = (label, pass, detail = "") => {
  results.push(pass);
  console.log(`${pass ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
};

const { browser, page } = await launch({ mobile: true });

// Record every confirm() the page raises. The COUNT is the assertion, because
// a bubbled press produces a different count than a contained one.
// ⚠ RECORD ONLY — DO NOT ACCEPT. `launch()` already installs an auto-accepting
// handler (lib.mjs:21); a second one that also accepts throws
// "Cannot accept dialog which is already handled!" and kills the run.
// Listeners are additive, so this one still sees every dialog.
const dialogs = [];
page.on("dialog", (d) => dialogs.push(d.message()));

try {
  await loginExpo(page, "pay-driver-parent@swimsync.test");

  // ⚠ REACH BILLING BY TAPPING THE TAB, NOT `goto`. A `goto(${EXPO}/billing)`
  // after login lands back on /home here — and the billing screen mounts
  // briefly on the way, so it stays in `document.body.innerText` underneath
  // (§7.10/§7.58). The first draft of this driver did exactly that and scored
  // four PASSes reading a screen it was not on, then tapped a child card on
  // /home. Assert the URL before believing any body text.
  await tap(page.getByText("Billing").last(), "billing tab");
  await page.waitForTimeout(7000);
  check(
    "the Billing tab is actually open",
    /\/billing/.test(page.url()),
    page.url()
  );

  // visibleText, not innerText: three of the checks below are NEGATIVE, and a
  // screen React Navigation has left mounted can satisfy the thing they deny
  // (§7.98 — the rule this same commit adds).
  let body = await visibleText(page);
  check("the outstanding invoice is listed", body.includes("INV-2026-9901"), "");
  check("the list card offers Pay via PayNow", body.includes("Pay via PayNow"));
  check("the list card offers I've paid", body.includes("I've paid"));
  check(
    "the claimed line is NOT shown before any claim",
    !body.includes("told your coach")
  );

  // ── 1. Pay via PayNow goes to the PayNow screen for THIS invoice ──────────
  const urlBeforePay = page.url();
  await tap(page.getByText("Pay via PayNow").last(), "pay via paynow");
  await page.waitForTimeout(5000);
  check(
    "Pay via PayNow opens the PayNow screen carrying invoiceId",
    /\/billing\/paynow\?invoiceId=/.test(page.url()),
    page.url()
  );
  check(
    "…and it did NOT route via the invoice detail screen",
    !/\/billing\/invoice\//.test(page.url()),
    urlBeforePay
  );

  // ── 2. THE RISK 9 CHECK: claim from the list, one dialog, no navigation ───
  await page.goBack();
  await page.waitForTimeout(6000);
  check(
    "back on the invoice list",
    /\/billing/.test(page.url()) && !/paynow/.test(page.url()),
    page.url()
  );

  dialogs.length = 0;
  const urlBeforeClaim = new URL(page.url()).pathname;
  await tap(page.getByText("I've paid").last(), "i've paid (list card)");
  await page.waitForTimeout(5000);

  check(
    "claiming raised EXACTLY ONE confirm dialog",
    dialogs.length === 1,
    `saw ${dialogs.length}: ${JSON.stringify(dialogs)}`
  );
  check(
    "…and it was the claim's own copy",
    dialogs.length === 1 && /made the PayNow transfer/.test(dialogs[0]),
    dialogs[0] ?? "none"
  );
  // The one that fails if the buttons are ever nested back inside the card.
  check(
    "the press did NOT also fire the card's navigation",
    new URL(page.url()).pathname === urlBeforeClaim,
    `${urlBeforeClaim} -> ${new URL(page.url()).pathname}`
  );

  // ── 3. The claimed state replaces the button, in place ───────────────────
  body = await visibleText(page);
  check(
    "the card now says the coach has been told",
    body.includes("told your coach") && body.includes("confirm it"),
    ""
  );
  check(
    "the I've paid button is gone (a claim is one-way)",
    !body.includes("I've paid")
  );
  check(
    "Pay via PayNow REMAINS — a claim is a statement, not a payment",
    body.includes("Pay via PayNow")
  );

  // ── 4. It survives a reload, so the claim reached the database ───────────
  // ⚠ A RELOAD LANDS THE PARENT ON /home, NOT BACK ON /billing — the root
  // layout restores the session and routes to the landing tab. Navigate back
  // before asserting. This check passed for the wrong reason until 2026-08-08,
  // when it was switched from document.body.innerText to visibleText: the
  // billing screen mounts briefly during the reload and stays in the DOM
  // underneath /home (§7.10/§7.58), so the old assertion was reading a screen
  // the driver was no longer on. Exactly the false pass §7.98 is about.
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForTimeout(8000);
  await tap(page.getByText("Billing").last(), "billing tab after reload");
  await page.waitForTimeout(7000);
  check(
    "the Billing tab is open again after the reload",
    /\/billing/.test(page.url()),
    page.url()
  );
  body = await visibleText(page);
  check(
    "the claim persisted across a reload (paid_claimed_at is fetched by the LIST)",
    body.includes("told your coach"),
    ""
  );
  check(
    "the invoice is still OUTSTANDING — claiming never changes status (PRD §7.21)",
    body.includes("Outstanding"),
    ""
  );
} catch (e) {
  check("driver completed without throwing", false, String(e));
} finally {
  const passed = results.filter(Boolean).length;
  console.log(`\n${passed}/${results.length} checks passed`);
  await browser.close();
  process.exit(passed === results.length ? 0 : 1);
}
