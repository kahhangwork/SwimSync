// App L-F/G/H (docs/refactor/BATCH_FGH_PLAN.md, ⚠ R4): network-request counts per screen —
// LOAD (the 6 s after arriving) and IDLE (the next 10 s). A hook extraction that churns a
// dependency shows as a higher IDLE count (a fetch loop) or a doubled LOAD count (a double fire).
// Baseline on main at L0; re-run at every L4 and compare. Screens are reached by TAP (§7.254).
// Run from .claude/skills/run-ui-playwright/drivers/ (copy it there) after a db reset +
// fixtures-payment-collection.sql.
import { launch, loginExpo, pressByText } from "./lib.mjs";

const API = /:54321\/(rest|auth|functions|storage)\//;
const out = [];

async function measure(page, label, arrive) {
  const hits = [];
  const on = (r) => { if (API.test(r.url())) hits.push({ t: Date.now(), u: r.method() + " " + r.url().replace(/\?.*/, "") }); };
  page.on("request", on);
  const t0 = Date.now();
  await arrive();
  await page.waitForTimeout(16000);
  page.off("request", on);
  const load = hits.filter((h) => h.t - t0 <= 6000);
  const idle = hits.filter((h) => h.t - t0 > 6000);
  out.push(`${label.padEnd(20)} load=${String(load.length).padStart(3)} idle=${idle.length}` +
    (idle.length ? `  idle: ${[...new Set(idle.map((h) => h.u))].join(", ")}` : ""));
}

{
  const { browser, page } = await launch();
  await measure(page, "parent /home", () => loginExpo(page, "pay-driver-parent@swimsync.test"));
  await measure(page, "parent /billing", () => pressByText(page, "Billing"));
  await measure(page, "parent /attendance", () => pressByText(page, "Attendance"));
  await browser.close();
}
{
  const { browser, page } = await launch();
  await loginExpo(page, "coach@swimsync.test");
  await page.waitForTimeout(4000);
  await measure(page, "coach /classes", () => pressByText(page, "Classes"));
  await browser.close();
}
console.log(out.join("\n"));
