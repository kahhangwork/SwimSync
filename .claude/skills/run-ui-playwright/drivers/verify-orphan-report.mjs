// verify-orphan-report.mjs — the standing "recorded after billing" report
// (Wave 4): its sidebar badge, its per-line persistence, and both settle paths.
//
// Prereqs: stack + admin dev server up, fixtures-orphan-report.sql applied.
// ⚠ NOT RE-RUNNABLE BY HAND: the driver records settlements, which is exactly
// what empties the report. Apply fixtures-orphan-report-teardown.sql (then the
// fixture) between runs. The fixture guard below detects the leftover
// settlements and says so rather than failing checks one by one.
//
// What it proves, in order:
//   1–2   fixture is in place, report has exactly 2 lines server-side
//   3     the Invoices sidebar item carries the badge, count 2
//   4–6   the section renders: heading, both lines, counts + month label
//   7–8   Write off clears ONE line; the settlement row says written_off/NULL
//   9     the other line SURVIVES — the report is per line, not per screenful
//   10–11 Paid outside (amount) clears the last line; row says 60.00, dated
//         at the line's LATEST lesson (never today)
//   12    the section unmounts when empty — no empty amber box
//   13    the badge is gone after navigation

import { execSync } from "node:child_process";
import { launch, loginAdmin, ADMIN } from "./lib.mjs";

const TENANT = "ab000000-0000-0000-0000-000000000001";
const KID_TWO = "OrphanRpt Two Lessons";
const KID_ONE = "OrphanRpt One Lesson";
const KID_TWO_ID = "ab500000-0000-0000-0000-000000000001";
const KID_ONE_ID = "ab500000-0000-0000-0000-000000000002";
const ADMIN_EMAIL = "orphan-admin@swimsync.test";
const ADMIN_UID = "ab100000-0000-0000-0000-0000000000a1";

let pass = 0;
let fail = 0;

function check(label, ok, detail = "") {
  if (ok) {
    pass++;
    console.log(`  ✓ ${label}${detail ? ` — ${detail}` : ""}`);
  } else {
    fail++;
    console.log(`  ✗ ${label}${detail ? ` — ${detail}` : ""}`);
  }
}

function sql(q) {
  return execSync(
    `docker exec -i supabase_db_SwimSync psql -U postgres -d postgres -tAc ${JSON.stringify(
      q.replace(/\n/g, " ")
    )}`,
    { encoding: "utf8" }
  ).trim();
}

/** Run one statement AS the fixture admin. The RPC refuses a caller with no
 *  JWT — including psql's superuser — which check 3 of the pgTAP file pins.
 *  So the driver's own probes impersonate the way pgTAP does: claims GUC +
 *  SET ROLE, one psql invocation, and the SET tags filtered off the output. */
function sqlAs(uid, q) {
  const script = `SET request.jwt.claims = '{"sub":"${uid}","role":"authenticated"}'; SET ROLE authenticated; ${q.replace(/\n/g, " ")}`;
  return execSync(
    `docker exec -i supabase_db_SwimSync psql -U postgres -d postgres -tAc ${JSON.stringify(script)}`,
    { encoding: "utf8" }
  )
    .split("\n")
    .filter((l) => l !== "SET" && l !== "")
    .join("\n")
    .trim();
}

(async () => {
  // ── Fixture guard: rows exist AND no settlement has consumed them yet.
  const marks = Number(
    sql(`SELECT count(*) FROM attendance WHERE student_id::text LIKE 'ab500000-%'`)
  );
  const leftovers = Number(
    sql(`SELECT count(*) FROM student_settlements WHERE student_id::text LIKE 'ab500000-%'`)
  );
  if (marks !== 3 || leftovers !== 0) {
    console.log(
      marks !== 3
        ? `FIXTURE MISSING: expected 3 OrphanRpt attendance rows, found ${marks}. Apply drivers/fixtures-orphan-report.sql.`
        : `STALE RUN: ${leftovers} OrphanRpt settlement(s) already recorded — a previous run settled the lines. Apply fixtures-orphan-report-teardown.sql, then the fixture.`
    );
    process.exit(1);
  }
  check("fixture in place", true, "3 marks, 0 settlements");

  // The report, server-side, before any UI is involved: 2 lines, read as the
  // fixture admin (the RPC refuses an unauthenticated caller — pgTAP checks
  // 3–4 pin that; this driver only needs the predicate's answer).
  const lines = sqlAs(
    ADMIN_UID,
    `SELECT student_id::text || ':' || lessons FROM unbilled_sealed_lessons('${TENANT}') ORDER BY 1`
  ).replace(/\s+/g, ",");
  check(
    "RPC reports 2 lines (2 + 1 lessons)",
    lines === `${KID_TWO_ID}:2,${KID_ONE_ID}:1`,
    lines
  );

  const { browser, page } = await launch();
  try {
    await loginAdmin(page, ADMIN_EMAIL);

    // ── The badge, from a page that is NOT /invoices.
    // Since 2026-08-17 Invoices lives inside the collapsed "Billing" group, so
    // from the dashboard its count BUBBLES to the group header pill — the whole
    // point of §3's requirement that a collapsed group never hides a stuck-family
    // signal. The badge must be readable without expanding anything.
    const badge = page.locator('[data-testid="navgroup-billing-badge"]');
    await badge.waitFor({ timeout: 10000 }).catch(() => {});
    check(
      "Billing group header shows the badge (2) from the dashboard, collapsed",
      (await badge.count()) === 1 && (await badge.innerText()) === "2",
      `count=${await badge.count()}`
    );

    // ── The standing section. Navigating to /invoices auto-expands Billing, so
    // the child link's own badge is now visible — assert that too.
    await page.goto(`${ADMIN}/invoices`, { waitUntil: "networkidle" });
    const childBadge = page.locator('a[href="/invoices"] span');
    await childBadge.waitFor({ timeout: 10000 }).catch(() => {});
    check(
      "expanded, the Invoices child link carries its own badge (2)",
      (await childBadge.count()) === 1 && (await childBadge.innerText()) === "2",
      `count=${await childBadge.count()}`
    );
    const report = page.locator('[data-testid="orphan-report"]');
    await report.waitFor({ timeout: 10000 });
    check("report section renders on /invoices", true);
    const text = await report.innerText();
    check(
      "both lines render with their counts",
      text.includes(KID_TWO) &&
        text.includes("2 billable lessons") &&
        text.includes(KID_ONE) &&
        text.includes("1 billable lesson"),
      ""
    );
    // The month label — "Jul 2026" style, derived the same way the page does.
    const monthLabel = sql(
      `SELECT to_char((now() AT TIME ZONE 'Asia/Singapore') - INTERVAL '1 month', 'Mon YYYY')`
    );
    check(
      `lines name the sealed month (${monthLabel})`,
      text.includes(monthLabel),
      ""
    );

    // ── Write off the one-lesson line.
    const oneLine = report.locator("li", { hasText: KID_ONE });
    await oneLine.getByRole("button", { name: "Write off", exact: true }).click();
    await oneLine.waitFor({ state: "detached", timeout: 10000 });
    check("Write off clears its line", true);
    const wroteOff = sql(
      `SELECT kind || ':' || COALESCE(amount::text,'NULL') FROM student_settlements WHERE student_id = '${KID_ONE_ID}'`
    );
    check("the row is written_off with NO amount", wroteOff === "written_off:NULL", wroteOff);
    check(
      "the two-lesson line SURVIVES the other's settlement",
      (await report.locator("li", { hasText: KID_TWO }).count()) === 1
    );

    // ── Pay the two-lesson line outside SwimSync.
    const twoLine = report.locator("li", { hasText: KID_TWO });
    await twoLine.locator("input").fill("60");
    await twoLine
      .getByRole("button", { name: "Paid outside SwimSync", exact: true })
      .click();
    await report.waitFor({ state: "detached", timeout: 10000 });
    check("Paid outside clears the last line AND the section unmounts", true);
    const paid = sql(
      `SELECT kind || ':' || amount::text || ':' || settled_through::text
         FROM student_settlements WHERE student_id = '${KID_TWO_ID}'`
    );
    const d2 = sql(
      `SELECT (date_trunc('month', (now() AT TIME ZONE 'Asia/Singapore')) - INTERVAL '1 month' + INTERVAL '14 days')::date::text`
    );
    check(
      "the row is paid_outside, 60.00, dated at the line's LATEST lesson",
      paid === `paid_outside:60.00:${d2}`,
      paid
    );
    check(
      "RPC now reports 0 lines",
      sqlAs(ADMIN_UID, `SELECT count(*) FROM unbilled_sealed_lessons('${TENANT}')`) === "0"
    );

    // ── The badge is gone after navigating (it re-reads per navigation).
    await page.goto(`${ADMIN}/dashboard`, { waitUntil: "networkidle" });
    await page.waitForTimeout(2000);
    check(
      "sidebar badge is gone once everything is settled",
      // Robust to Billing being either expanded (no child span) or collapsed
      // (no header pill) — the count is 0 either way once settled.
      (await page.locator('a[href="/invoices"] span').count()) === 0 &&
        (await page.locator('[data-testid="navgroup-billing-badge"]').count()) === 0
    );
  } finally {
    await page.screenshot({ path: "/tmp/orphan-report-final.png" }).catch(() => {});
    await browser.close();
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
