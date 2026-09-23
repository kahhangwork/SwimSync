// Hand-checks for App L-H (docs/refactor/BATCH_FGH_PLAN.md, ⚠ R5): the coach Settings
// writes no verify-* driver presses.
//   A. the fallback PayNow QR upload (expo-image-picker's web file input → Storage →
//      tenants.paynow_qr_url) — the image shows, the row points at it.
//   B. coach Sign Out: confirm → /login, and a reload stays signed out.
// Run from .claude/skills/run-ui-playwright/drivers/ (copy it there) after a db reset.
// coach@swimsync.test is the seed tenant_admin, so the upload is permitted.
import { launch, loginExpo, pressByText } from "./lib.mjs";
import { execSync } from "node:child_process";
import { writeFileSync } from "node:fs";

const SHOT = process.env.SHOTDIR ?? "/tmp";
const TAG = process.env.TAG ?? "hc";
const psql = (sql) =>
  execSync(`docker exec -i supabase_db_SwimSync psql -U postgres -d postgres -v ON_ERROR_STOP=1 -tA -c "${sql}"`)
    .toString()
    .trim();
const res = [];
const check = (ok, msg) => res.push(`${ok ? "PASS" : "FAIL"} ${msg}`);
const MARCUS = "70000000-0000-0000-0000-000000000001";

// A 1×1 PNG.
const PNG = "/tmp/hc-qr.png";
writeFileSync(
  PNG,
  Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==", "base64")
);
psql(`UPDATE tenants SET paynow_qr_url = NULL WHERE id = '${MARCUS}'`);

{
  const { browser, page } = await launch();
  await loginExpo(page, "coach@swimsync.test");
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
  const toast = await page.getByText("Your PayNow QR code has been updated.").first().waitFor({ timeout: 20000 }).then(() => true).catch(() => false);
  check(toast, "A: the upload Toast shows");
  const url = psql(`SELECT coalesce(paynow_qr_url, '') FROM tenants WHERE id = '${MARCUS}'`);
  check(/\/storage\/v1\/object\/public\/paynow-qr\/70000000-0000-0000-0000-000000000001\/paynow-qr\?t=\d+$/.test(url), `A: tenants.paynow_qr_url points at the tenant-scoped object (${url})`);
  check((await page.getByText("Replace QR Code").count()) > 0, "A: the button now reads Replace QR Code");
  check((await page.locator("img").count()) > 0, "A: the uploaded image renders");
  await page.screenshot({ path: `${SHOT}/hcH-${TAG}-A-upload.png` });

  // ── B. Sign Out ──
  await pressByText(page, "Sign Out"); // confirmAction → window.confirm, accepted by lib
  const out = await page.waitForURL(/\/login/, { timeout: 15000 }).then(() => true).catch(() => false);
  check(out, "B: coach Sign Out lands on /login");
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForTimeout(6000);
  check(/\/login/.test(page.url()), `B: …and a reload stays signed out (${page.url()})`);
  await browser.close();
}

console.log(res.join("\n"));
console.log(`${res.filter((r) => r.startsWith("PASS")).length}/${res.length} hand-checks passed`);
process.exit(res.every((r) => r.startsWith("PASS")) ? 0 : 1);
