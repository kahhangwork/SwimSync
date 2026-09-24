// verify-app-coach-settings.mjs — the coach Settings writes no other driver presses.
//
// WHY THIS EXISTS. Promoted from the App L-H hand-check
// (docs/refactor/app-fgh-handchecks-H.mjs), proven on the pre-refactor AND the
// refactored Settings:
//   A. The fallback PayNow QR upload — expo-image-picker's web <input type=file>
//      → Storage (paynow-qr/<tenant>/paynow-qr) → tenants.paynow_qr_url. The
//      Toast, the tenant-scoped URL, the button flips to Replace, the image shows.
//   B. Coach Sign Out: confirm → /login, and a reload stays signed out.
//
// No fixture: coach@swimsync.test is the SEED tenant admin, so the upload is
// permitted, and the seed's paynow_qr_url is NULL. The driver resets that
// column before it starts and, in `finally`, puts the seed back — the column to
// NULL and the uploaded object removed — so a sibling reading the seed tenant's
// PayNow setup never sees this run's image.
//
// Setup: `supabase db reset` (seed only). Expo web on :8081 (or EXPO_URL).

import os from "node:os";
import path from "node:path";
import { mkdtempSync, writeFileSync } from "node:fs";
import { execSync } from "node:child_process";
import { launch, loginExpo, pressByText, visibleText } from "./lib.mjs";

const SHOT = process.env.SHOT_DIR ?? os.tmpdir();
const shot = (n) => `${SHOT}/app-coach-settings-${n}.png`;
const API_URL = "http://127.0.0.1:54321";
const MARCUS = "70000000-0000-0000-0000-000000000001";
const OBJECT = `${MARCUS}/paynow-qr`;

const results = [];
const check = (label, pass, detail = "") => {
  results.push(pass);
  console.log(`${pass ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
};
const psql = (sql) =>
  execSync(`docker exec -i supabase_db_SwimSync psql -U postgres -d postgres -v ON_ERROR_STOP=1 -tA -c "${sql}"`)
    .toString()
    .trim();
const waitOk = (p) => p.then(() => true).catch(() => false);

// run-all-drivers.sh exports the key; a solo run reads it off the stack.
const serviceKey =
  process.env.SERVICE_ROLE_KEY ??
  execSync("supabase status -o env", { encoding: "utf8" }).match(/^SERVICE_ROLE_KEY="?([^"\n]+)"?$/m)[1];
const { createClient } = await import(
  new URL("../../../../SwimSyncAdmin/node_modules/@supabase/supabase-js/dist/index.mjs", import.meta.url).href
);
const svc = createClient(API_URL, serviceKey, { auth: { persistSession: false } });

/** Put the seed tenant's PayNow QR back to the seed state: no URL, no object. */
async function restoreSeed() {
  psql(`UPDATE tenants SET paynow_qr_url = NULL WHERE id = '${MARCUS}'`);
  const { error } = await svc.storage.from("paynow-qr").remove([OBJECT]);
  if (error) throw error;
}

// A 1×1 PNG.
const PNG = path.join(mkdtempSync(path.join(os.tmpdir(), "app-coach-settings-")), "qr.png");
writeFileSync(
  PNG,
  Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==", "base64")
);

await restoreSeed();
const { browser, page } = await launch();
try {
  await loginExpo(page, "coach@swimsync.test");

  // ── A. upload the fallback QR ─────────────────────────────────────────────
  await pressByText(page, "Settings");
  await page.getByText("Fallback QR image — advanced").first().waitFor({ timeout: 20000 });
  await pressByText(page, "Fallback QR image — advanced");
  await page.getByText("Upload QR Code").last().waitFor({ timeout: 10000 });
  const [chooser] = await Promise.all([
    page.waitForEvent("filechooser", { timeout: 15000 }),
    // A TRUSTED click: the web picker is an <input type=file>.click(), which Chrome
    // only honours inside a real user gesture — pressByText's synthetic events are not.
    page.locator('text="Upload QR Code" >> visible=true').click(),
  ]);
  await chooser.setFiles(PNG);
  check(
    "A: the upload Toast shows",
    await waitOk(page.getByText("Your PayNow QR code has been updated.").first().waitFor({ timeout: 20000 }))
  );
  const url = psql(`SELECT coalesce(paynow_qr_url, '') FROM tenants WHERE id = '${MARCUS}'`);
  check(
    "A: tenants.paynow_qr_url points at the tenant-scoped object",
    new RegExp(`/storage/v1/object/public/paynow-qr/${MARCUS}/paynow-qr\\?t=\\d+$`).test(url),
    url
  );
  check("A: the button now reads Replace QR Code", (await visibleText(page)).includes("Replace QR Code"));
  // Scoped to the uploaded object: the hand-check's bare `img` count also
  // matched unrelated images, so it could not fail (§7.25).
  check("A: the uploaded image renders", (await page.locator(`img[src*="/paynow-qr/${MARCUS}/"]`).count()) > 0);
  await page.screenshot({ path: shot("A-upload") });

  // ── B. Sign Out ───────────────────────────────────────────────────────────
  await pressByText(page, "Sign Out"); // confirmAction → window.confirm, accepted by launch()
  check("B: coach Sign Out lands on /login", await waitOk(page.waitForURL(/\/login/, { timeout: 15000 })), page.url());
  await page.reload({ waitUntil: "domcontentloaded" });
  // The form, not a sleep: a restored session would bounce off /login once hydrated.
  await page.getByPlaceholder("you@email.com").waitFor({ timeout: 45000 }).catch(() => {});
  await page.waitForTimeout(3000);
  check("B: …and a reload stays signed out", /\/login/.test(page.url()), page.url());
} catch (e) {
  check("driver completed without throwing", false, String(e));
} finally {
  await browser.close().catch(() => {});
  await restoreSeed().catch((e) => console.error(`✗ could not restore the seed PayNow QR: ${e.message}`));
  const passed = results.filter(Boolean).length;
  console.log(`\n${passed}/${results.length} checks passed`);
  process.exit(passed === results.length ? 0 : 1);
}
