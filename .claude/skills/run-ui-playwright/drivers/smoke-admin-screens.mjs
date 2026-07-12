import { launch, loginAdmin, dumpText } from "./lib.mjs";

const OUT = process.env.SHOT_DIR || "/tmp";
const { browser, page } = await launch();

const routes = ["/attendance", "/students", "/dashboard"];

try {
  await loginAdmin(page, "superadmin@swimsync.test", "password123");
  console.log("logged in as superadmin");

  for (const route of routes) {
    await page.goto(`http://localhost:3000${route}`, { waitUntil: "networkidle" });
    await page.waitForTimeout(1500);
    const text = await dumpText(page);
    const name = route.slice(1);
    await page.screenshot({ path: `${OUT}/admin-${name}.png`, fullPage: true });

    // Flag the silent-failure markers P3 targets.
    const flags = [];
    if (/NaN/.test(text)) flags.push("NaN");
    if (/Invalid Date/.test(text)) flags.push("Invalid Date");
    if (/No records found|No invoices found|No .*found/i.test(text)) flags.push("empty-table");

    console.log(`\n===== ${route} =====`);
    console.log(text.replace(/\n{2,}/g, "\n").slice(0, 1200));
    console.log(`FLAGS[${name}]:`, flags.length ? flags.join(", ") : "none");
  }
} catch (e) {
  console.error("ERROR:", e.message);
  await page.screenshot({ path: `${OUT}/admin-error.png` });
} finally {
  await browser.close();
}
