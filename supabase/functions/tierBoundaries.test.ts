// The Edge Functions are being decomposed into tiers
// (docs/plans/EDGE_FUNCTIONS_REFACTOR_PLAN.md, Part B, stage B0):
//
//   index.ts  →  domain  →  dao  →  (PostgREST | rpc | Resend)
//
// The Deno twin of SwimSyncAdmin/lib/tierBoundaries.drift.test.ts — a test that
// reads the source, because the functions have no linter. Over SCOPE (the three
// functions Part B splits; public-invoice / public-package are already handler +
// pure core and stay out):
//
//   1. domain/ never touches the network: no `.from("…")`, `.rpc(`, `.auth.`,
//      `fetch(` or `createClient`, and no VALUE import from supabase-js. It may
//      hold a client TYPE and pass it to dao/.
//   2. dao/ never imports domain/.
//   3. Data access outside dao/ only where the ledger pins it.
//   4. index.ts imports only its own tiers, types.ts, constants.ts, ../_shared/,
//      supabase-js, and the facades named in FACADES.
//   5. resendGate's module state (`lastResendStart`, `gateChain`) is declared
//      EXACTLY ONCE under supabase/functions — a copy would double the send rate
//      (plan RISK 5).
//   6. domain/ reads no clock (`new Date()` with no argument, `Date.now()`)
//      except where the ledger pins it (plan RISK 2): a moved slice must take
//      `now`, never read it.
//
// THE LEDGERS ARE DEBT, NOT EXEMPTIONS. Each entry pins a file AND a content
// snippet AND how many lines match it; the hygiene test fails when the count
// is wrong in EITHER direction, so a moved call forces its entry down and a new
// one cannot hide behind an old entry. The ledgers only shrink. Never add an
// entry after B0 — a new violation is a new violation — with ONE exception: when a
// slice MOVES a pre-existing line into domain/ (check 6), its entry is added in that
// slice's commit and the B-gate census must prove the count unchanged. Entries
// marked STAYS are permanent, with the reason.
//
// Print the current violations as ledger entries: FENCE_PRINT=1 deno test --allow-read=.. <this file>
//
// §7.25: every check was proven RED at B0 by breaking it on purpose (the
// commit message lists each), then reverted.

import { assertEquals } from "jsr:@std/assert@1";

const ROOT = new URL(".", import.meta.url).pathname.replace(/\/$/, ""); // supabase/functions
const SCOPE = ["generate-invoices", "package-emails", "credit-note-emails"];
const FACADES: Record<string, string[]> = {
  // Kept for the whole plan: index.ts, bench/run.ts and the tests import these
  // names, and the bench must keep comparing old engines against new (plan §5).
  "generate-invoices": ["./core.ts", "./runLog.ts", "./clock.ts", "./email.ts"],
  "package-emails": [],
  "credit-note-emails": [],
};

type Entry = { file: string; snippet: string; count: number; why: string };

// ── Check 3 ledger: data access outside dao/ ─────────────────────────────────
const ALLOWED_DATA_ACCESS: Entry[] = [
  { file: "generate-invoices/clock.ts", snippet: "let res = await client.rpc(\"app_now\");", count: 1, why: "STAYS — clock.ts is not moved (plan §5); dbNow takes its client as an argument" },
  { file: "generate-invoices/clock.ts", snippet: "res = await client.rpc(\"app_now\");", count: 1, why: "STAYS — clock.ts is not moved (plan §5); dbNow takes its client as an argument" },
  { file: "package-emails/email.ts", snippet: "const res = await fetch(\"https://api.resend.com/emails\", {", count: 1, why: "B11 moves it to dao/" },
  { file: "package-emails/index.ts", snippet: "anon.rpc(\"is_platform_admin\"),", count: 1, why: "B11 moves it to dao/" },
  { file: "package-emails/index.ts", snippet: "anon.rpc(\"has_admin_area\", { p_tenant: tenantId, p_area: \"packages\", p_level: \"edit\" }),", count: 1, why: "B11 moves it to dao/" },
  { file: "package-emails/index.ts", snippet: "const { data: userRes } = await anon.auth.getUser();", count: 1, why: "B11 moves it to dao/" },
  { file: "package-emails/index.ts", snippet: ".from(\"referral_rewards\")", count: 1, why: "B11 moves it to dao/" },
  { file: "package-emails/index.ts", snippet: ".from(\"parent_packages\")", count: 1, why: "B11 moves it to dao/" },
  { file: "package-emails/index.ts", snippet: ".from(\"profiles\")", count: 1, why: "B11 moves it to dao/" },
  { file: "credit-note-emails/core.ts", snippet: ".from(\"credit_notes\")", count: 4, why: "B12 moves it to dao/" },
  { file: "credit-note-emails/core.ts", snippet: ".from(\"credit_applications\")", count: 1, why: "B12 moves it to dao/" },
  { file: "credit-note-emails/core.ts", snippet: ".from(\"tenants\")", count: 1, why: "B12 moves it to dao/" },
  { file: "credit-note-emails/core.ts", snippet: ".from(\"parent_tenant_balances\")", count: 1, why: "B12 moves it to dao/" },
  { file: "credit-note-emails/core.ts", snippet: "const { data, error } = await svc.rpc(\"claim_credit_note_email\", {", count: 1, why: "B12 moves it to dao/" },
  { file: "credit-note-emails/email.ts", snippet: "const res = await fetch(\"https://api.resend.com/emails\", {", count: 1, why: "B12 moves it to dao/" },
  { file: "credit-note-emails/index.ts", snippet: "const { data: userRes } = await anon.auth.getUser();", count: 1, why: "B12 moves it to dao/" },
  { file: "credit-note-emails/index.ts", snippet: "const { data: sessionTenant } = await anon.rpc(\"session_tenant\", {", count: 1, why: "B12 moves it to dao/" },
  { file: "credit-note-emails/index.ts", snippet: "anon.rpc(\"coach_is_main_on_session\", { p_session_id: lesson_session_id }),", count: 1, why: "B12 moves it to dao/" },
  { file: "credit-note-emails/index.ts", snippet: "anon.rpc(\"is_platform_admin\"),", count: 1, why: "B12 moves it to dao/" },
  { file: "credit-note-emails/index.ts", snippet: "anon.rpc(\"has_admin_area\", { p_tenant: tenantId, p_area: \"operations\", p_level: \"edit\" }),", count: 1, why: "B12 moves it to dao/" },
  { file: "credit-note-emails/index.ts", snippet: "const { data: isTenantAdmin } = await anon.rpc(\"has_admin_area\", {", count: 1, why: "B12 moves it to dao/" },
];

// ── Check 4 ledger: index.ts imports beyond the allowed set ──────────────────
const ALLOWED_INDEX_IMPORTS: Entry[] = [
  { file: "package-emails/index.ts", snippet: "import { authorizePackageEmail, buildConfirmedHtml, buildConfirmedSubject, buildOfferedHtml, buildOfferedSubject, buildReferralRewardHtml, buildReferralRewardSubject, buildRequestedHtml, buildRequestedSubject, sgDateOfStamp, type ReferralRewardEmailData, sendPackageEmail, type PackageEmailData, } from \"./email.ts\";", count: 1, why: "B11 — index.ts imports its tiers" },
  { file: "credit-note-emails/index.ts", snippet: "import { fetchBalances, fetchTenantSuspended, findEmailedInvoiceItemIds, findSpentNoteIds, findUnsentById, findUnsentBySession, resendSender, sendNotes, } from \"./core.ts\";", count: 1, why: "B12 — index.ts imports its tiers" },
  { file: "credit-note-emails/index.ts", snippet: "import { authorizeCreditNoteEmail, canEmailForTenant } from \"./email.ts\";", count: 1, why: "B12 — index.ts imports its tiers" },
];

// ── Check 6 ledger: clock reads in domain/ ───────────────────────────────────
const ALLOWED_CLOCK: Entry[] = [
  // All three MOVED into domain/ at B10 with email.ts — pre-existing reads, not new
  // ones; the B-gate census proves the function's clock-read count unchanged.
  { file: "generate-invoices/domain/emailDelivery.ts", snippet: "? { invoice_email_sent_at: new Date().toISOString(), invoice_email_claimed_at: null }", count: 1, why: "STAYS — the settle's own sent-at stamp (moved at B10)" },
  { file: "generate-invoices/domain/emailDelivery.ts", snippet: "const wait = lastResendStart + spacing - Date.now();", count: 1, why: "STAYS — resendGate's rate clock (plan §5: allow-listed; moved at B10)" },
  { file: "generate-invoices/domain/emailDelivery.ts", snippet: "lastResendStart = Date.now();", count: 1, why: "STAYS — resendGate's rate clock (plan §5: allow-listed; moved at B10)" },
];

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const e of Deno.readDirSync(dir)) {
    const p = `${dir}/${e.name}`;
    if (e.isDirectory) {
      if (e.name === "bench" || e.name === "node_modules") continue;
      out.push(...walk(p));
    } else if (e.name.endsWith(".ts") && !e.name.endsWith(".test.ts") && e.name !== "test-helpers.ts") {
      out.push(p);
    }
  }
  return out.sort();
}

const rel = (p: string) => p.slice(ROOT.length + 1);

/** Source lines with comments removed (line comments only where `//` starts the
 *  line or follows whitespace, so a URL inside a string survives; JSDoc and block
 *  comment lines dropped). Line-based on purpose — the ledger pins lines. */
function codeLines(src: string): string[] {
  const out: string[] = [];
  let inBlock = false;
  for (const raw of src.split("\n")) {
    let line = raw;
    if (inBlock) {
      const end = line.indexOf("*/");
      if (end < 0) { out.push(""); continue; }
      line = line.slice(end + 2);
      inBlock = false;
    }
    const start = line.search(/(^|\s)\/\*/);
    if (start >= 0 && !line.slice(start).includes("*/")) {
      line = line.slice(0, start);
      inBlock = true;
    }
    line = line.replace(/(^|\s)\/\/.*$/, "$1");
    out.push(line.trim());
  }
  return out;
}

const DATA = /\.from\(\s*["'`]|\.rpc\(|\.auth\.|\bfetch\(/;
// domain/ may not even BUILD a client; index.ts composing one is its job.
const DOMAIN_ONLY = /\bcreateClient\b/;
const CLOCK = /new Date\(\s*\)|\bDate\.now\(\s*\)/;
const IMPORT = /^(?:import|export)\b[^;]*?\bfrom\s*["']([^"']+)["']|^import\s*["']([^"']+)["']/;

type Hit = { file: string; line: string };

function scan(): { files: string[]; data: Hit[]; clock: Hit[]; indexImports: Hit[]; domainBad: Hit[]; daoBad: Hit[] } {
  const files = SCOPE.flatMap((fn) => walk(`${ROOT}/${fn}`)).map(rel);
  const data: Hit[] = [], clock: Hit[] = [], indexImports: Hit[] = [], domainBad: Hit[] = [], daoBad: Hit[] = [];
  for (const file of files) {
    const fn = file.split("/")[0];
    const tier = file.split("/")[1];
    const src = Deno.readTextFileSync(`${ROOT}/${file}`);
    // Join a multi-line import into one line so its specifier is read.
    // Parens excluded so a function body can never be swallowed (import lists hold none).
    const joined = src.replace(/^(?:import|export)\s[^;()]*?\bfrom\s*["'][^"']+["'];?/gms, (m) => m.replace(/\s*\n\s*/g, " "));
    for (const line of codeLines(joined)) {
      if (!line) continue;
      const imp = line.match(IMPORT);
      const spec = imp ? (imp[1] ?? imp[2]) : null;
      if (tier === "domain") {
        if (DATA.test(line) || DOMAIN_ONLY.test(line)) domainBad.push({ file, line });
        if (spec && /supabase-js/.test(spec) && !/^(import|export)\s+type\b/.test(line)) domainBad.push({ file, line });
        if (CLOCK.test(line)) clock.push({ file, line });
      } else if (tier === "dao") {
        if (spec && /(^|\/)domain\//.test(spec)) daoBad.push({ file, line });
      } else if (DATA.test(line)) {
        data.push({ file, line });
      }
      if (file === `${fn}/index.ts` && spec) {
        const ok = /^npm:@supabase\/supabase-js@/.test(spec) || spec.startsWith("../_shared/") ||
          /^\.\/(dao|domain)\//.test(spec) || spec === "./types.ts" || spec === "./constants.ts" ||
          FACADES[fn].includes(spec);
        if (!ok) indexImports.push({ file, line });
      }
    }
  }
  return { files, data, clock, indexImports, domainBad, daoBad };
}

/** Hits not covered by the ledger, and ledger entries whose count is wrong. */
function settle(hits: Hit[], ledger: Entry[]): { uncovered: Hit[]; wrong: string[] } {
  const used = new Map<Entry, number>();
  const uncovered: Hit[] = [];
  for (const h of hits) {
    // The MOST SPECIFIC entry wins, so a generic `.from("x")` entry never claims a
    // line a longer snippet pins.
    const e = ledger
      .filter((x) => x.file === h.file && h.line.includes(x.snippet))
      .sort((a, b) => b.snippet.length - a.snippet.length)[0];
    if (e) used.set(e, (used.get(e) ?? 0) + 1);
    else uncovered.push(h);
  }
  const wrong = ledger
    .filter((e) => (used.get(e) ?? 0) !== e.count)
    .map((e) => `${e.file} ${JSON.stringify(e.snippet)}: ledger says ${e.count}, found ${used.get(e) ?? 0}`);
  return { uncovered, wrong };
}

const fmt = (hits: Hit[]) => hits.map((h) => `  ${h.file}: ${h.line}`).join("\n");

if (Deno.env.get("FENCE_PRINT")) {
  const s = scan();
  for (const [name, hits] of [["DATA", s.data], ["INDEX", s.indexImports], ["CLOCK", s.clock]] as const) {
    const counts = new Map<string, number>();
    for (const h of hits) counts.set(`${h.file}\u0000${h.line}`, (counts.get(`${h.file}\u0000${h.line}`) ?? 0) + 1);
    console.log(`// ${name}: ${hits.length} lines`);
    for (const [k, n] of counts) {
      const [file, line] = k.split("\u0000");
      console.log(`  { file: ${JSON.stringify(file)}, snippet: ${JSON.stringify(line)}, count: ${n}, why: "" },`);
    }
  }
}

Deno.test("fence: every SCOPE folder exists and has source", () => {
  for (const fn of SCOPE) {
    const n = walk(`${ROOT}/${fn}`).length;
    if (n === 0) throw new Error(`${fn}: no source files found — the scan would pass vacuously`);
  }
});

Deno.test("fence 1: domain/ never touches the network", () => {
  const { domainBad } = scan();
  assertEquals(domainBad, [], `domain/ must hand data access to dao/:\n${fmt(domainBad)}`);
});

Deno.test("fence 2: dao/ never imports domain/", () => {
  const { daoBad } = scan();
  assertEquals(daoBad, [], `dao/ imports domain/:\n${fmt(daoBad)}`);
});

Deno.test("fence 3: data access outside dao/ only where the ledger pins it", () => {
  const { uncovered } = settle(scan().data, ALLOWED_DATA_ACCESS);
  assertEquals(uncovered, [], `unpinned data access outside dao/ — move it to dao/:\n${fmt(uncovered)}`);
});

Deno.test("fence 4: index.ts imports only its tiers, _shared, supabase-js and its facades", () => {
  const { uncovered } = settle(scan().indexImports, ALLOWED_INDEX_IMPORTS);
  assertEquals(uncovered, [], `index.ts imports outside the allowed set:\n${fmt(uncovered)}`);
});

Deno.test("fence 5: resendGate's state is declared exactly once", () => {
  for (const name of ["lastResendStart", "gateChain"]) {
    const decl = new RegExp(`^\\s*(let|var|const)\\s+${name}\\b`);
    const where: string[] = [];
    for (const fn of Deno.readDirSync(ROOT)) {
      if (!fn.isDirectory) continue;
      for (const f of walk(`${ROOT}/${fn.name}`)) {
        for (const line of codeLines(Deno.readTextFileSync(f))) if (decl.test(line)) where.push(rel(f));
      }
    }
    assertEquals(where.length, 1, `${name} declared ${where.length}× (${where.join(", ")}) — move it, never copy it`);
  }
});

Deno.test("fence 6: domain/ reads no clock except where the ledger pins it", () => {
  const { uncovered } = settle(scan().clock, ALLOWED_CLOCK);
  assertEquals(uncovered, [], `a clock read in domain/ — take \`now\` as an input:\n${fmt(uncovered)}`);
});

Deno.test("fence: every ledger entry matches exactly its count (the ledgers only shrink)", () => {
  const s = scan();
  const wrong = [
    ...settle(s.data, ALLOWED_DATA_ACCESS).wrong,
    ...settle(s.indexImports, ALLOWED_INDEX_IMPORTS).wrong,
    ...settle(s.clock, ALLOWED_CLOCK).wrong,
  ];
  assertEquals(wrong, [], `stale ledger entries — lower or delete them:\n  ${wrong.join("\n  ")}`);
});
