# Edge Functions refactor — generated types, then tiers

_Drafted 2026-11-17. Plan-reviewed 2026-11-17 (mitigations inlined as ⚠ RISK n). Status: DONE — Part A live 2026-11-17 (v41), Part B live 2026-11-18 (v42). October billing for the two test tenants dropped (owned by others); first live run = Coach Kah Hang's November._

Two refactors, applied to `supabase/functions/` the way they were applied to the apps:

- **Part A — generated types** (the Wave 8 shape, `docs/plans/WAVE8_GENERATED_TYPES_PLAN.md`): every `createClient`
  typed with the generated `Database`, every database read typed from its own select, the explicit `any`s gone.
- **Part B — tiers** (the feature-tier shape, `docs/refactor/FEATURE_TIER_REFACTOR_PLAYBOOK.md`): `dao/` (every
  `.from()` / `.rpc()`), `domain/` (pure billing and email logic), and the handler (`index.ts`, composition only).

## 0. Decisions (user, 2026-11-17)

| # | Decision |
|---|---|
| D1 | **Types first**, then tiers. |
| D2 | Tier split covers **generate-invoices + package-emails + credit-note-emails**. `public-invoice` / `public-package` are already handler + pure `core.ts` and get Part A only. |
| D3 | **Refactor first, then bill October** for Little Orcas + Epic Swim. October is the refactored engine's first live run. |
| D4 | **Deploy once per refactor**: once after Part A (all 5 functions), once after Part B. |
| D5 | **Tests are restructured too**, to mirror the new folders (`core.test.ts` 2,186 lines, `test-helpers.ts` 1,121). |

### Questions to put to the user BEFORE P0 (answers recorded here)

- **Q1** ⚠ RISK 1 MITIGATION: Invoicing is manual (Free tier, no cron), and either business's admin can press
  Generate at any time. Ask the user to confirm that the Little Orcas and Epic Swim admins have been told **not to
  generate October until told**. Without a yes, D3 cannot hold, so do not start. Answer (user, 2026-11-17): **both
  tenants hold TEST DATA only and have not onboarded** — a wrong October run there costs no real family. Proceed.
- **Q2** ⚠ RISK 1 MITIGATION: Offer the **held-emails October run** (§6 step O5): briefly unset `RESEND_API_KEY`,
  generate, reconcile, restore the key, then press Generate again so the retry pass sends. Default is **NO** unless
  the user says yes. Answer: **No** (test-data tenants; user may still switch before §6).
- **Q3** (optional, reconsider only, never assumed): (a) bill October on v40 before the refactor instead of after
  (ranked risk 1); (b) let B13 (tests only) follow October (ranked risk 8). The plan below honours D3 and D5 as
  decided unless the user changes them. Answer: **neither** — D3 and D5 stand as decided.

## 1. The rule

**Nothing changes behaviour.** Same as playbook §0: every commit is a move, the suite stays green, and a needed
behaviour change becomes a `BACKLOG.md` item rather than a commit in this plan. A bug found along the way goes into
§9's ledger and is fixed **after** Part B ships, in its own commit (the Wave 8 precedent, `fffa342`).

⚠ RISK 6 MITIGATION: A §9 row that touches October's **amounts, which lessons are billed, the seal, or an email
recipient** is a **BLOCKER for the October run**. It is fixed after the Part B deploy and before §6's October run:
its own `fix(edge)` commit, a failing-first test (§7.25), the bench, and its own deploy. That is still "after Part B
ships". Any other §9 row waits.

The guards move **verbatim** and are never reworded, merged or reordered: not-ended month, unreadable settings,
suspended tenant, auto-disabled, sealed month, ordering guard, run-day guard, unmarked-attendance hard stop,
**unreadable package mode** (`package_mode_unreadable`). CLAUDE.md "Billing — the guards are load-bearing".
**Do NOT add a `force`, skip or override parameter to any guard function created in this plan.**

⚠ RISK 7 MITIGATION (branch discipline): Part A lives on `refactor/edge-types` and Part B on `refactor/edge-tiers`.
Each merges to `main` **only immediately before its own deploy** (A6, §6), so `main` never holds an undeployed,
half-refactored engine that another session could deploy. An urgent engine fix during the refactor goes on `main`
from the live sha (DEPLOYMENT §11) and is then merged into the branch.

⚠ RISK 10 MITIGATION (where the work happens): A0 runs in the **root checkout** (`gen-db-types.sh` refuses in a
worktree). If a worktree is used for the rest, never `run-all-drivers.sh --only` while a sibling session is running
(it resets the shared database), and start `supabase functions serve` **from the checkout under test**.

⚠ RISK 3/6 MITIGATION (commit labels): A Part A commit is labelled `types(edge): …` and must exit 0 on the extended
`scripts/check-runtime-identical.sh` (P3). A commit that cannot pass it is not a Part A commit: it becomes a §9 row.
A Part B commit is labelled `refactor(edge): …` and is proven by the bench, the censuses (B-gate) and the suite, not
by runtime identity.

## 2. What exists (measured 2026-11-17, re-verified at review)

| Function | Files | DB calls | Explicit `any` |
|---|---|---|---|
| generate-invoices | `core.ts` 1,803 (`generateForTenant` L323–~1,790), `email.ts` 1,039, `orderingGuard.ts` 443, `runLog.ts`, `clock.ts`, `attendanceCompleteness.ts` (pure), `dates.ts`, `rates.ts`, `index.ts` 212 | core 22, email 13, orderingGuard 10, runLog 1 | email 8, **core 1 (`CountedQuery`, L79)**, orderingGuard 0 (L238 is a comment) |
| package-emails | `index.ts` 241, `email.ts` 348 | in `index.ts` (svc `.from` ×3; caller-JWT `anon.rpc` ×2) | 6 |
| credit-note-emails | `index.ts` 221, `core.ts` 499, `email.ts` 425 | `core.ts` (svc), `index.ts` (caller-JWT `anon.rpc` only) | 0 |
| public-invoice / public-package | `index.ts` 99 + `core.ts` ~170 | `core.ts` | 0 |

Total explicit `any` = 15. Census command (A3):
`grep -rnE "(: any\b|as any|any\[\]|<any>|= any;|, any>|\| any)" --include='*.ts' supabase/functions | grep -v '\.test\.ts:' | grep -v /bench/ | grep -v test-helpers`.

Every `createClient` is **untyped**, so every read is implicitly `any`. That gap is much bigger than the 15
explicit `any`s.

**Cross-function imports (they decide what each deploy bundles, §7.187):** `package-emails/email.ts` imports
`../generate-invoices/dates.ts` at runtime. This is live proof that relative imports across function folders already
bundle. `credit-note-emails/core.test.ts` imports `../generate-invoices/core.ts` and `test-helpers.ts`.
`public-invoice/core.test.ts` and `public-package/core.test.ts` import `newScenario` from
`../generate-invoices/test-helpers.ts`.

**verify_jwt (live state, must survive every deploy):** generate-invoices, public-invoice and public-package are
**false** (`config.toml`). package-emails and credit-note-emails are **true** (no `config.toml` entry, so the CLI
default applies).

The gates that exist:
- `deno check ../*/index.ts` (CI; entry points only, not recursive).
- `generate-invoices/test.sh` (Deno, needs the stack, **run twice**, §7.15). It runs an **explicit list of 22 test
  files**; a file not on the list never runs.
- The bench harness `generate-invoices/bench/` (byte-identical dump, `compare.py`, 4 seed sizes, §8.166). **The bench
  imports `core.ts`, `email.ts` and `runLog.ts` by path from `ENGINE_DIR`** and replays `index.ts`'s orchestration, so
  those three module surfaces must keep their exports throughout, or old-vs-new comparison stops working.

**What the gates can NOT see today (fixed in §3):**
- `compare.py` compares database rows only. It does not see Resend requests (recipient, subject, HTML,
  Idempotency-Key), `emails_sent` / `emails_retried`, request counts, `index.ts`, the cron/multi-tenant path or any
  guard refusal.
- `check-runtime-identical.sh` treats **every** change under `supabase/functions/` as a runtime change, so a
  `types(…)` commit there fails CI and Part A has no transpile proof.
- G6 (`check-db-any.sh`) covers only the two apps.

## 3. Preflight — tooling and baselines (~1 day, before Part A)

Tooling and test-infrastructure only. No function source changes.

- **P0 — baselines.** Record in this file:
  - The runner's summary line from `test.sh` run twice, e.g. `ok | N passed (M steps) | 0 failed`.
  - The sorted list of `Deno.test` names, written to the scratchpad.
  - `supabase functions list -o json`: each function's version and `verify_jwt`.
  - The live engine's sha (v40 = `47996d2`) and the last sha that billed live (v39, from DEPLOYMENT §11).
  - ⚠ RISK 1 MITIGATION: Run
    `scripts/prod-query-ro.sh "select t.display_name, r.billing_month, r.status, r.sealed, r.ran_at from billing_runs r join tenants t on t.id = r.tenant_id where r.billing_month = '2026-10' order by r.ran_at"`
    as a **bare command** (no `cd`, `&&` or `||` around it). Assertion: no row exists for Little Orcas or Epic Swim.
    If one does, STOP and tell the user, because D3's premise is gone. Repeat this check before A6, before the §6
    deploy and before §6 O3.
- **P0 RECORDED (2026-11-17):**
  - `test.sh` ×2: `ok | 320 passed | 0 failed` both runs (1m41s, 1m40s).
  - Prod functions: credit-note-emails v7 `verify_jwt` true · generate-invoices v40 false · package-emails v8 true ·
    public-invoice v3 false · public-package v3 false.
  - Live engine sha `47996d2` (v40).
  - October on prod: one row only, Coach Kah Hang (sealed, 7 invoices, 2026-11-16). No Little Orcas / Epic Swim row.
  - (The reviewer's query used `r.created_at`, which does not exist; corrected above to `ran_at`. Run every SQL string.)
- **P1 — `test.sh` lists every test.** ⚠ RISK 8 MITIGATION (structural): `test.sh` fails, before running anything, if
  the set of `*.test.ts` files under `supabase/functions` (excluding `bench/`) differs from its run list, and prints
  the difference. Prove it red by adding an empty unlisted `x.test.ts`, then revert. From here on, a moved or new test
  file cannot silently skip.
- **P2 — the bench sees emails and round trips.** ⚠ RISK 3 MITIGATION. Extend `bench/run.ts` (the content, not the
  layout) so the dump includes:
  - **`resend`**: every intercepted `api.resend.com` request as `{to, subject, sha256(html), idempotency_key}`.
    Normalise every uuid through `labels` and every invoice `public_token` to `TOKEN:<invoice label>`, then sort.
  - **`emails`**: `{emails_sent, emails_retried}`.
  - **`requests`**: the per-phase `byTarget` request counts.

  Prove it is not vacuous: in a scratch copy of the engine, change one subject character, then separately the
  idempotency-key prefix, then separately turn one `Promise.all` into sequential awaits. Assertion: `compare.py`
  reports DIFFERENT for each. Prohibition: no change to `bench/seed.ts`.
- **P2 DONE (2026-11-17):** `bench/run.ts` dumps `resend` (to/from/subject/html sha256/idempotency key, with uuids,
  invoice tokens and the seed's random tag relabelled), `emails`, `requests` (per-phase `byTarget`). v40 (`47996d2`) vs
  the working tree at 6×2: IDENTICAL. Mutants: subject one space → `DIFF resend`; idempotency prefix → `DIFF resend`;
  one extra query → `DIFF requests`. **Correction:** request COUNTS cannot see a `Promise.all` turned sequential (same
  requests, different timing) — that mutant is caught by the B-gate's `Promise.all(` census, not the bench.
- **P3 — runtime identity for functions.** ⚠ RISK 3/6 MITIGATION. Extend `scripts/check-runtime-identical.sh` and
  `scripts/lib/runtime-identical.mjs` so that a **modified** non-test `.ts` under `supabase/functions/` is
  transpile-compared with `SwimSyncAdmin/node_modules/typescript`, the same as app files. Specifics:
  - `supabase/functions/_shared/database.types.ts` and `_shared/database.overrides.ts` are allow-listed like the apps'
    copies.
  - An added pure-type module is allowed. Any other added file, deletion or `bench/` change stays a runtime change.

  Prove it red with a `?.` added to `public-invoice/core.ts` in a scratch commit, and green with a `: string`
  annotation added. Both scratch commits are discarded.
- **P4 — the any-ratchet covers functions.** ⚠ RISK 9 MITIGATION. Add `supabase/functions` to G6
  (`scripts/check-db-any.sh`) with its own `.db-any-allowance`, seeded from today's census (15). Rule 4 (only
  `import type` for `database.types`) applies there too. Prove it red with one added `as any`.
- **P5 — verify_jwt is declared.** ⚠ RISK 7 MITIGATION (structural): add `[functions.package-emails] verify_jwt = true`
  and `[functions.credit-note-emails] verify_jwt = true` to `supabase/config.toml`, with a comment that this declares
  the live value (P0's record). Assertion: P0's `-o json` record already shows `true` for both. If not, STOP and ask
  the user.

- **P1 DONE (2026-11-17):** `test.sh` holds a `TESTS` array and refuses (exit 2) when it ≠ the `*.test.ts` files on
  disk. Proven red twice: an unlisted `x.test.ts` (`on disk, NOT RUN`), and a renamed test file (both directions).
- **P3 DONE (2026-11-17):** `check-runtime-identical.sh` + `runtime-identical.mjs` treat `supabase/functions/` as a
  unit (SwimSyncAdmin's TypeScript; `_shared/database.types.ts` ignored, `_shared/database.overrides.ts` allow-listed;
  a new `<fn>/index.ts`, `bench/` and non-`.ts` files are runtime). Proven: `?.` added in `public-invoice/core.ts` →
  exit 1 with a JS diff; a parameter annotation → exit 0; added pure-type `types.ts` → allowed; added runtime
  `domain/x.ts` → runtime; `bench/note.ts` → runtime; `newfn/index.ts` → runtime. Three past Wave 8 app commits still
  pass. **Use G6 (below) as the `any` census, not §2's grep.**
- **P4 DONE (2026-11-17):** G6 covers `supabase/functions` (excluding tests, `test-helpers.ts`, `bench/`,
  `_shared/database.types.ts`). Seeded `supabase/functions/.db-any-allowance` = **20** in 6 files (G6 also counts
  `as unknown as` etc., which §2's grep missed): credit-note-emails/core 2, generate-invoices/core 1, email 8,
  package-emails/index 6, public-invoice/core 1, public-package/core 2. Proven red with an added `as any`.
- **P5 DONE (2026-11-17):** `config.toml` declares `verify_jwt = true` for package-emails and credit-note-emails
  (P0 recorded both live as `true`). Parsed: all 5 functions present with the live values.
**P gate:** every proof above recorded red-then-green · `test.sh` ×2 matches P0's line ·
`git diff --exit-code supabase/functions/generate-invoices/deno.lock`.

## 4. Part A — generated types (~1 day)

- **A0 — the third types target.** Add `supabase/functions/_shared/database.types.ts` to `DB_TYPES_TARGETS` in
  `scripts/lib/db-types.sh` and produce it with `scripts/gen-db-types.sh`. **Never copy it by hand.** Add
  `supabase/functions/_shared/database.overrides.ts`. The apps' overrides file imports `./database.types` without an
  extension, which Deno can't resolve, so the functions copy differs by **that one import line only**.
  - ⚠ RISK 9 MITIGATION: `check-db-types.sh` diffs the functions overrides against
    `SwimSyncAdmin/lib/database.overrides.ts` with exactly that one line normalised. Prove it red by changing one
    `NULLABLE_RPC_ARGS` entry in the functions copy, then revert.
  - ⚠ RISK 9 MITIGATION: Prove G5 red by editing one byte in `_shared/database.types.ts`, running
    `scripts/check-db-types.sh`, then reverting.
  - ⚠ RISK 9 MITIGATION: Run `scripts/check-db-types.sh` locally before every push (CI's G5 runs after Vercel has
    deployed). Root checkout only (§7.347).
- **A1 — deploy probe.** In `public-invoice` (the smallest), add
  `import type { Database } from "../_shared/database.overrides.ts"` and use it in one type position. Then
  `supabase functions deploy public-invoice`.
  - ⚠ RISK 7 MITIGATION, before deploying:
    - `scripts/check-runtime-identical.sh HEAD~1 HEAD` exits 0.
    - `supabase functions serve` from this checkout boots it locally, and a POST with a bogus token returns the shared
      404.
    - The tree is clean: `git status --porcelain supabase/functions` is empty.
    - The rollback is staged: `git worktree add <scratchpad>/rollback-a1 <live sha>`, and
      `supabase functions deploy public-invoice --workdir <scratchpad>/rollback-a1` is written into the draft
      DEPLOYMENT §11 entry.
  - ⚠ RISK 7 MITIGATION, after deploying:
    - `functions list -o json` shows the version +1 and `verify_jwt: false`.
    - A POST with a bogus token returns the shared 404.
    - One real public invoice link loads. **Do NOT press "I've paid".**
    - Any failure triggers the rollback command at once.
  - Gate: the live public invoice page loads.
- **A1 DONE (2026-11-17):** `a9611eb` typed public-invoice (core + index) against `../_shared/database.overrides.ts`;
  runtime-identical. Local serve boots it; bogus token → shared 404. **Prod: public-invoice v3 → v4**, `verify_jwt`
  false, bogus token → `{"error":"not_found"}` 404, a real Oct invoice → 200 with the 11 public fields (read-only GET).
  `_shared/` imports bundle on deploy. Rollback staged: worktree at `47996d2` (`<scratchpad>/rollback-47996d2`),
  `supabase functions deploy public-invoice --workdir <it> --project-ref cdmjeyauhxcgulhbxmsb`.
- **Wave 8 precedent adopted for A2/A3:** a `+`-joined select widens to `string` and loses the row type (§7.106).
  The fix is ONE literal whose evaluated string is proven byte-identical (`deno eval` printing old and new); P3
  flags the textual change, so that commit is labelled `fix(edge): … (select byte-identical)` and carries the proof.
- **A2 — type the clients.** Type every `createClient(...)` as `createClient<Database>(...)` and every
  `SupabaseClient` parameter as `SupabaseClient<Database>`, using **the overrides `Database`**, never `Generated`. One
  function per commit, in this order: `public-*`, credit-note-emails, package-emails, generate-invoices. Fix what
  `deno check` and the Deno suite turn up by typing from the select, never by casting. A `!` that is not a guard gets
  the Wave 8 comment ("NOT A GUARD").
  - ⚠ RISK 6 MITIGATION: Each commit is `types(edge): <fn>` and exits 0 on
    `scripts/check-runtime-identical.sh HEAD~1 HEAD`. **Do NOT** edit a select string, add, remove or move a `?.`,
    `??`, `|| …` or `Array.isArray` normaliser, or change a payload key in a Part A commit (§7.348).
  - ⚠ RISK 6 MITIGATION: The anon clients in package-emails and credit-note-emails carry the caller's JWT, so RLS
    applies. **Never delete a `?.`, a fallback or a normaliser on an embed because the type says it is non-null**
    (§7.344).
  - ⚠ RISK 6 MITIGATION (the only escape hatch): A read that cannot be typed type-only (e.g. an ambiguous embed typed
    `SelectQueryError`) gets a hand-written row type and **one** cast at that site, marked `// db-any-ok: <reason>`
    and listed in §9's census. It is still type-only, so the commit still passes P3.
  - ⚠ RISK 6 MITIGATION: zero TS2589 ("excessively deep") errors. Record `deno check`'s wall time in the commit
    message.
  - Gate: `deno check` (A4's scope once A4 lands, `../*/index.ts` before that) + `test.sh` ×2 green.
- **A3 — remove the explicit `any`s** (G6's census: 20 at P4).
  - ⚠ RISK 9 MITIGATION: lower `supabase/functions/.db-any-allowance` in the same commit (`check-db-any.sh --update`),
    so the slack cannot be refilled.
  - Gate: the census is 0 outside tests and `bench/`, except listed `db-any-ok` sites (e.g. `CountedQuery` if it
    cannot be typed type-only).
- **A4 — widen CI's `deno check`** to every non-test `.ts`, recursively: the list comes from
  `find supabase/functions -name '*.ts' ! -name '*.test.ts' ! -path '*/bench/*'`, so the `dao/` and `domain/` folders
  Part B creates are included automatically.
  - ⚠ RISK 10 MITIGATION: the CI step prints the number of files checked. Assertion: it equals the `find` count.
  - Gate: prove red with a deliberate type error in a non-entry module **inside a subfolder** (e.g. `_shared/`).
- **A5 — bench.** `ENGINE_DIR` = the **live sha `47996d2`** (not "main", which moves) vs the typed engine, at all 4
  seed sizes (4×2, 6×2, 12×5, 30×6), with P2's dump.
  - ⚠ RISK 3 MITIGATION: Extract the old engine with
    `git archive 47996d2 supabase/functions | tar -x -C <scratchpad>/old`. Archive the **whole `supabase/functions`**,
    because the new engine resolves `../_shared/`. Leave `SEED_ENGINE_DIR` unset so each side bills its own September
    (speed plan §5 method).
  - Gate: `compare.py` IDENTICAL at all 4 sizes, including the `resend`, `emails` and `requests` keys.
- **A2–A5 DONE (2026-11-17):** every client typed (`types(edge)` ×7, each runtime-identical). The types surfaced
  three trigger-filled `invoices` columns (`due_date`, `reference_number`, `public_token`) → `d0ab953` adds them to
  `TRIGGER_FILLED_COLUMNS` (proven against the live triggers). Three `+`-joined selects became one literal (`fix(edge)`
  ×3, each evaluated string proven byte-identical). G6 20 → **1** (`CountedQuery`, §9 census). A4: CI `deno check` over
  21 files, proven red. **A5: IDENTICAL vs `47996d2` at 4×2 (9 invoices), 6×2 (13), 12×5 (61), 30×6 (181 invoices,
  179 emails)**, `resend`/`emails`/`requests` included. Suite 320/320 ×2; admin vitest 1,351, app jest 862, both
  typecheck green. (A first A5 attempt was void: zsh `set -- $sz` did not split, so every size ran the default seed —
  §7.340 — rerun via a bash script.)
- **A6 — deploy Part A (D4).** Deploy all 5 functions, one at a time, each confirmed in `supabase functions list`. App
  types are unchanged, so no app change ships. Record the engine version in DEPLOYMENT §11.
  - ⚠ RISK 1 MITIGATION: re-run P0's October query first. Expect no rows for the two tenants.
  - ⚠ RISK 7 MITIGATION, before deploying:
    - Merge `refactor/edge-types` → `main` and push. Vercel rebuilds the unchanged apps; watch it with
      `scripts/watch-deploy.sh` under Monitor.
    - Deploy from the clean root checkout at that exact `main` sha: `git status --porcelain` is empty and
      `git rev-parse HEAD` equals `origin/main`.
    - Stage rollback worktrees at the live sha (`47996d2`), with one written rollback command per function.
  - ⚠ RISK 7 MITIGATION, how to deploy:
    - Order: public-package, public-invoice, credit-note-emails, package-emails, generate-invoices.
    - **Do NOT run `supabase functions deploy` without a function name.**
    - **Do NOT pass `--no-verify-jwt` to package-emails or credit-note-emails.**
  - ⚠ RISK 7 MITIGATION, after **each** function deploy:
    - `functions list -o json` shows the version +1 and `verify_jwt` equal to P0's record.
    - Run a boot probe that writes nothing and sends nothing:
      - generate-invoices: POST with no Authorization → `401 Unauthorized`.
      - public-invoice and public-package: POST with a bogus token → the shared 404.
      - package-emails and credit-note-emails: POST `{}` with `Authorization: Bearer <anon key>` → `400` "bad
        request".
    - A failed probe means that function is rolled back at once and the remaining deploys stop.
  - ⚠ RISK 7 MITIGATION: The boot probes above replace a real "test email". They spend no Resend quota and reach no
    parent. If the user wants a real email, it goes to an internal address only.
  - ⚠ RISK 7 MITIGATION: Record in DEPLOYMENT §11 that Part A has **no download-provable difference**:
    `functions download` returns type-stripped source, which is identical by construction (§7.187). The proof is P3's
    runtime identity + the version bump + the boot probes.
  - Gate (prod): open one public invoice and one public package link (read-only).

- **A6 DONE (2026-11-17):** `ff70ac0` on `main`; deployed one at a time: public-package v4, public-invoice v5,
  credit-note-emails v8, package-emails v9, **generate-invoices v41**. Every probe PASS, `verify_jwt` unchanged, real
  package + invoice reads 200. DEPLOYMENT #107. **Part B's bench baseline is now the Part A deploy sha `ff70ac0`**
  (runtime-identical to `47996d2`; benching against `47996d2` stays valid and is what B uses — its archive is already
  extracted).

## 5. Part B — tiers (~3–4 days)

### Shape

```
supabase/functions/<fn>/
  index.ts        # handler only: parse, auth, compose, respond
  types.ts        # entity types (rows come from Database, §4)
  constants.ts
  dao/            # <fn>.repo.ts (.from), <fn>.rpc.ts (.rpc), resend.ts (fetch to Resend)
  domain/         # pure logic + orchestration that takes dao functions as arguments
  test/           # D5 — mirrors domain/ and dao/
```

Dependency direction: `index.ts → domain → dao → client`. `domain/` never imports the client or calls `fetch`,
and `dao/` holds no billing logic, only thin calls returning `{ data, error }` (playbook Stage 2's rule: error
handling unchanged by one character).

**`core.ts`, `email.ts` and `runLog.ts` stay as re-export facades for the whole plan, through the October run.**
⚠ RISK 3 MITIGATION: **Do NOT delete the facades in this plan.** `bench/run.ts` loads `${ENGINE_DIR}/core.ts`,
`email.ts` and `runLog.ts`, and deleting them breaks every future old-vs-new comparison. Deleting them is a
`BACKLOG.md` item. **Do NOT re-implement anything in a facade:** a facade is `export { … } from "./domain/…"` lines
only.

**Do NOT move `dates.ts`, `clock.ts`, `rates.ts` or `attendanceCompleteness.ts`.** ⚠ RISK 7 MITIGATION:
package-emails bundles `../generate-invoices/dates.ts`, so moving it widens the deploy set.

**Do NOT run `deno fmt`, and do not re-indent template literals, on moved code.** ⚠ RISK 5 MITIGATION: whitespace
inside a template literal is email content.

**`generate-invoices/index.ts` changes ONLY its import specifiers in Part B.** ⚠ RISK 3 MITIGATION: no test imports
it. Assertion at every stage: `git diff <Part A sha> -- supabase/functions/generate-invoices/index.ts` shows only
`import` lines.

### B-gate — run at EVERY stage B0–B12 (one commit each)

- `deno check` (A4's scope) + `test.sh` **twice**, with the summary line equal to P0's (plus the fence's own tests
  from B0 on) + the fence.
- ⚠ RISK 3 MITIGATION: the **bench at all 4 sizes** against `47996d2` at **every stage that touches
  generate-invoices** (B1–B10), not only B4, B9, B10 and B14. `compare.py` IDENTICAL, including `resend`, `emails`
  and `requests`.
- ⚠ RISK 4 MITIGATION, **query-chain census** (a scratchpad script): extract every `.from("…")` / `.rpc("…")` call
  chain under each function folder, with whitespace normalised. Assertion: the multiset at HEAD equals the multiset
  at the Part A deploy sha. Prove it red once, before B2, by deleting one `.eq("tenant_id", …)` in a scratch copy.
- ⚠ RISK 4 MITIGATION, **shape censuses**, HEAD vs the Part A sha, per function. Each count is equal:
  - `Promise.all(` (generate-invoices: 5);
  - `try {`;
  - zero-argument `new Date()` / `Date.now()` (the clock census);
  - `Array.isArray(`;
  - `?.`;
  - `status: "` literals **in order**;
  - lines carrying `⚠`.
- `scripts/check-functions-sg-date.sh`, `scripts/check-sept.sh`, `scripts/check-db-any.sh` green, and
  `git diff --exit-code …/deno.lock` empty. ⚠ RISK 10 MITIGATION: **never regenerate the lock** (§7.385).

### Stages, one commit each

- **B0 — the fence.** A source-scanning Deno test, `supabase/functions/tierBoundaries.test.ts` (repo idiom; no
  ESLint). Checks:
  - `domain/` never imports a client or calls `fetch`;
  - `dao/` imports no `domain/`;
  - `index.ts` imports only its own tiers and `_shared`;
  - ⚠ RISK 5 MITIGATION: `lastResendStart` and `gateChain` are each declared **exactly once** under
    `supabase/functions`;
  - ⚠ RISK 2 MITIGATION: `domain/` contains no zero-argument `new Date()` or `Date.now()` except the allow-listed
    `resendGate`.

  Pin current violations by file + snippet, each naming the stage that removes it; an unmatched entry fails, so the
  list can only shrink. Prove each check red, then revert. Add the file to `test.sh` (P1 will refuse otherwise).
  - ⚠ RISK 10 MITIGATION: `test.sh` gains `--allow-read=..` for the scan. **Do NOT add any other permission.**
- **B1 — generate-invoices `types.ts` + `constants.ts`, verbatim.**
- **B2 — `dao/` for generate-invoices:** the 22 `core.ts` calls, the 10 `orderingGuard.ts` calls and `runLog.ts`'s 1.
  Keep `readPaged` / `readAllIn` (§7.391's keyset paging and chunking) **byte-for-byte**; they are the speed fix.
  - ⚠ RISK 4 MITIGATION: Assertion: the text of `readPaged`, `readAllIn`, `groupBy`, `IN_CHUNK` and `PAGE`, extracted
    from HEAD and from the Part A sha, is identical.
  - ⚠ RISK 4 MITIGATION: **A dao function that feeds `readPaged` / `readAllIn` returns an un-awaited builder from a
    `() =>` factory. Do NOT await inside it.** Otherwise the `.gt()` / `.order()` / `.limit()` paging is applied to
    nothing.
  - ⚠ RISK 4 MITIGATION: **Do NOT add a `try`/`catch` in `dao/`.** Every `if (error) throw` stays at its call site.
  - ⚠ RISK 4 MITIGATION: Every call in a `Promise.all` group moves as a group, and the group stays a `Promise.all`.
- **B3 — `dao/` for `email.ts`:** the 13 database calls, plus the Resend `fetch` into `dao/resend.ts`. `resendGate`
  and `EMAIL_CONCURRENCY` stay together in `domain/`.
  - ⚠ RISK 5 MITIGATION: `resendGate`, `lastResendStart` and `gateChain` **move, never copy**. The B0 fence enforces
    one declaration each.
  - ⚠ RISK 5 MITIGATION: `invoiceIdempotencyKey`'s body is byte-identical (checked by extracting its text), and P2's
    `resend.idempotency_key` is IDENTICAL.
- **B4–B9 — `generateForTenant` broken out** along the section banners already in it, one slice per commit, in this
  order. Each slice becomes a `domain/` function that takes its dao calls as arguments.
  - **(4)** The guards — not-ended, auto switch, unreadable settings, suspended, auto-disabled, sealed, ordering,
    run-day — moved as **one** block, with the comments.
  - **(5)** The phase-1 batched reads.
  - **(6)** Make-ups + trial rates.
  - **(7)** The unclaimed reduction + the unmarked hard stop.
  - **(8)** Package-paid lessons, including the `package_mode_unreadable` stop.
  - **(9)** Phase 2 (one invoice per parent) + the seal.

  `generateForTenant` ends as composition.
  - ⚠ RISK 2 MITIGATION, before B4: write a **slice contract** into the commit message for each of B4–B9. It lists
    every identifier declared before the slice and read inside it (inputs), every one it assigns or mutates and that
    is read after it (outputs), and every early `return`. Use a scratchpad script over
    `git show <Part A sha>:…/core.ts`, not your eyes.
  - ⚠ RISK 2 MITIGATION (structural): the guard function returns a discriminated union,
    `{ stop: GenerateResult } | { go: GuardContext }`. `GuardContext` carries `tenantRow`, `billingMonth`,
    `monthStart`, `monthEnd`, `now` and `mode`/`force` exactly as computed. **Do NOT use `null` / `undefined` to mean
    "proceed".** The compiler then forces the caller to branch.
  - ⚠ RISK 2 MITIGATION: Slices **return** their outputs. **Do NOT reassign a parameter, and do NOT leave a `let` in
    `generateForTenant` that a slice used to assign.** Assertion after B9: no `let` in `generateForTenant` is assigned
    inside a slice.
  - ⚠ RISK 2 MITIGATION (mutation proofs, §7.25 and playbook §5). In the **moved** code, break each item below once
    and record the named test that goes red (in the commit message), then revert:
    - B4: each of `month_not_ended`, `tenant_unreadable`, `tenant_suspended`, `auto_disabled`, `already_complete`,
      `earlier_month_unbilled`, `before_run_day`.
    - B7: delete the `incomplete_attendance` return.
    - B8: delete the `package_mode_unreadable` return.
    - B9: drop the §7.17 "≥1 class reckoned with" positive from the seal condition.

    A mutant nothing catches is a BLOCKER. Add a characterisation test (header says so) before continuing.
  - ⚠ RISK 2 MITIGATION: the ordered `status: "` census (B-gate) must be identical, so the guard order cannot change.
  - ⚠ RISK 2 MITIGATION: **Do NOT convert any guard `return` into a `throw`.** The cron loop has no per-tenant catch
    (`core.ts` comment, "Unreadable settings").
- **B10 — `email.ts` → `domain/`:** the subject/HTML builders, settle/outcome, `emailInvoices`, retry, resend and the
  blocked notice.
  - ⚠ RISK 5 MITIGATION: P2's `resend` key (to, subject, html hash, idempotency key) is IDENTICAL at all 4 sizes.
  - ⚠ RISK 5 MITIGATION: The texts of `buildInvoiceEmailSubject`, `buildInvoiceEmailHtml`, `buildBlockedEmailHtml`
    and `blockedNoticeRecipients` are byte-identical (checked by extraction).
- **B11 — package-emails:** `index.ts` reads → `dao/`, logic → `domain/`.
  - ⚠ RISK 5 MITIGATION, first (its own commit): extract **in place, verbatim** the pure mapping from the
    `reward`/`pkg` rows to `{ to, PackageEmailData | ReferralRewardEmailData }`, including every `Array.isArray`
    normaliser. Then pin characterisation tests (the header says they are characterisation tests, §7.25 exemption).
    Cases:
    - an array embed vs an object embed;
    - a `null` profile;
    - an RLS-null embed, which must give `to` undefined and no send;
    - referral → the recipient is the **reward's** parent;
    - each `type` → its subject builder.

    Mutation-prove one case (swap the recipient source) → red.
  - ⚠ RISK 5 MITIGATION (structural, type-only): brand the two clients,
    `type CallerDb = SupabaseClient<Database> & { readonly __caller: unique symbol }` and `type ServiceDb`.
    `packagesAdmin`, `auth.getUser` and every authorisation `.rpc` (`is_platform_admin`, `has_admin_area`) accept
    **only** `CallerDb`. Prove it: passing `svc` to `packagesAdmin` makes `deno check` go red.
- **B12 — credit-note-emails:** the same treatment as B11.
  - ⚠ RISK 5 MITIGATION: the same `CallerDb` brand for `session_tenant`, `coach_is_main_on_session`,
    `is_platform_admin` and `has_admin_area`, proven red the same way. The "Verbatim the live attendance_write policy"
    block moves byte-identical.
- ⚠ RISK 3 MITIGATION, **drivers after B9, B10, B11 and B12** (`run-all-drivers.sh --only <driver>`, one at a time,
  with `supabase functions serve` started from this checkout):
  - after B9 and B10: `verify-money-admin`, `verify-unmarked-lessons`;
  - after B11: `verify-package-renewal`, `verify-referrals`;
  - after B12: `example-credit-note-flow`, `verify-coach-marking`.

  **Do NOT start the full sweep** (user-requested only).
- **B0–B12 DONE (2026-11-17/18)**, one commit each (`dbc0997` … `1466966`), every stage gate GREEN (census vs
  `ff70ac0`, fence, suite ×2, and the bench at 4 sizes on every stage touching generate-invoices). Mutation proofs:
  B4 all 7 guards, B7 hard stop (18 tests), B8 fail-open drawn set, B9 vacuous seal, B11 recipient + normaliser.
  **Deviations, each recorded in its commit:** B5–B9 cut along the code's own sections (reads / class loop / unclaimed
  + hard stop / drawn / phase 2 + seal), not the plan's (6) "make-ups + trial rates" label; mode/force/now and the
  `if (blocking.length)` decision stay in generateForTenant; the fence's clock ledger gained 4 STAYS entries when
  pre-existing stamps MOVED into domain/ (census count unchanged); B11/B12 split into a/b(/c); service-side daos take
  the plain client (tests call them), caller-side take CallerDb only. **G6 was red B2→B12a unseen** (the gate printed
  its last line); fixed by typing CountedQuery structurally — functions G6 now **0**. **Drivers after B12** (functions
  served from this checkout): money-admin 44/44, unmarked-lessons 12/12, package-renewal 7/7, referrals 13/13,
  coach-marking 31/31. `example-credit-note-flow` is a TEMPLATE needing a hand seed, not a runnable driver — the
  credit-note path is covered by its 50 Deno tests + coach-marking.
- **B13 — tests (D5), in their own commits after the code is done, never in the same commit as a code move.** Split
  `core.test.ts` / `test-helpers.ts` into `test/` along the new modules. Before/after parity: the sorted list of
  `Deno.test` names is identical and the runner's passed count is unchanged.
  - ⚠ RISK 8 MITIGATION: Record the B12 sha. Assertion at every B13 commit:
    `git diff <B12 sha> HEAD -- supabase/functions ':(exclude)*.test.ts' ':(exclude)**/test/**' ':(exclude)**/test-helpers.ts' ':(exclude)**/test.sh'`
    is **empty**. The engine is frozen across the test move.
  - ⚠ RISK 8 MITIGATION: One test file per commit. P1 guarantees each moved file is in `test.sh`.
  - ⚠ RISK 8 MITIGATION (body-identical, a scratchpad script): the multiset of each `Deno.test` body
    (whitespace-normalised, import lines excluded) is identical before and after. The helper bodies, **teardown
    functions especially**, are byte-identical except their import lines.
  - ⚠ RISK 8 MITIGATION: The summary line `N passed (M steps)` equals P0's (+ the fence), on both runs. Also count
    `select count(*) from tenants` on the local database before the first run and after the second: equal, so nothing
    leaked (§7.15).
  - ⚠ RISK 8 MITIGATION: `test-helpers.ts` stays as a re-export facade, so the `credit-note-emails` and `public-*`
    tests keep importing `../generate-invoices/test-helpers.ts` unchanged.
  - ⚠ RISK 8 MITIGATION: Re-run B4/B7/B9's mutation proofs once on the restructured suite. Each mutant is still red.
  - ⚠ RISK 10 MITIGATION: Helpers under `test/` are scanned by G3 (it excludes `tests/`, not `test/`). Run
    `scripts/check-functions-sg-date.sh` after each B13 commit.
- **B14 — close-out.** Fence ledgers at zero. **Keep the facades** (above). Update CLAUDE.md's "`core.ts` is pure"
  line, `docs/ARCHITECTURE.md` §6, and `docs/TESTING.md` §5's Deno file list. Docs are edited from `main`, never from
  a worktree. Final B-gate including the bench.

- **B13 DONE (2026-11-18, `cdd0f7c`):** see its commit — bodies IDENTICAL (335), engine frozen vs `1466966`, suite ×2,
  no tenant leak, every mutant still red. **B14 DONE:** package-emails / credit-note-emails facades deleted (nothing
  imports them); generate-invoices facades kept; CLAUDE.md, ARCHITECTURE §6 + file map, TESTING §5 updated. Final
  gate: census IDENTICAL, fence 8/8, G6 0, suite 335/335 ×2, bench IDENTICAL at 4 sizes. (The census tool, like the
  fence and G6 before it, keyed on the old `test-helpers.ts` path and briefly counted `test/helpers.ts` as engine
  source; fixed to skip `test/`.)

## 6. Deploy Part B, then bill October (D4, then D3)

`/deploy` classifies it as engine-only (no migration, no app). Its advice of "no behaviour change ⇒ no deploy" is
overridden by D4; follow its ordering and verification.

- **D-1 — pre-checks.**
  - ⚠ RISK 1 MITIGATION: re-run P0's October query. Expect no rows for the two tenants.
  - ⚠ RISK 7 MITIGATION, the deploy set comes from the import graph, not the folders (§7.187):
    `git diff --stat <Part A deploy sha> HEAD -- supabase/functions/<fn>/` plus every `../` file each function
    imports. Deploy exactly the functions whose graph changed (expected: credit-note-emails, package-emails,
    generate-invoices).
  - ⚠ RISK 7 MITIGATION: merge `refactor/edge-tiers` → `main` and push (Vercel watched with
    `scripts/watch-deploy.sh`). Then deploy from the clean root at that `main` sha. Stage rollback worktrees at the
    **Part A deploy sha**, with written commands.
- **D-2 — deploy** one at a time: credit-note-emails, package-emails, generate-invoices last.
  - ⚠ RISK 7 MITIGATION: after each deploy, the same version, `verify_jwt` and boot-probe assertions as A6. Also
    `supabase functions download <fn>`, then assert that a Part-B-only **file** exists in the download (e.g.
    `generate-invoices/domain/…`), then `git checkout -- supabase/functions/` to restore the tree. A failed probe
    triggers that function's rollback at once.
  - Record it in DEPLOYMENT §11, including the rollback commands.
- **O1 — §9 blockers.** ⚠ RISK 6 MITIGATION: every §9 row marked BLOCKER (§1) is fixed, tested, benched and deployed
  before O3. No blockers open is a box on the gate.
- **O2 — predict October.** ⚠ RISK 1 MITIGATION:
  - Write one read-only SQL statement that predicts, per parent, the count of October lessons the engine will bill
    (billable attendance minus package-paid, with make-ups and paid trials included).
  - **Prove it on the local database first:** run the bench at 12×5 with `KEEP=1` and assert the SQL predicts the
    bench tenant's per-parent `invoice_items` + `package_applications` counts exactly. A SQL string never run is not a
    proof.
  - Then run it on prod with `scripts/prod-query-ro.sh` (a bare command) for both tenants and record the result here.
  - ⚠ RISK 1 MITIGATION: Count the expected invoices for both tenants and compare with Resend → Usage's remaining
    daily quota (100/day). If expected > remaining, follow INVOICE_RUNBOOK "A big month" (spread over days or
    upgrade). The user decides.
- **D-1/D-2 DONE (2026-11-18):** `2833602` on `main`; credit-note-emails v9, package-emails v10, **generate-invoices
  v42**, probes PASS, v42's download holds every Part B file. DEPLOYMENT #108. **O1:** no §9 BLOCKER (row 1 is a
  test-timing flake). **O2 DONE:** the prediction SQL (scratchpad `o2predict.sql`) matched the engine's real output
  for all 59 parents of a local 12×5 bench tenant. Prod, read-only: **Epic Swim 0 invoices** (nothing billable after
  package draws), **Little Orcas 1 invoice, 5 lines** (parent `79539438…`); neither had an October invoice. Resend:
  ≤ 1 email, far under 100/day.
- **O3/O4 NOT RUN — decision (user, 2026-11-18):** Little Orcas and Epic Swim belong to other people; their admins
  generate, not us, and both hold test data only. October stays unbilled for them until their owners bill it. **The
  refactored engine's first real billing run is Coach Kah Hang's November (early December)** — before it, rerun the
  O2 prediction for that tenant/month and reconcile per parent after; read `billing_runs.duration_ms`. A zero-write
  live smoke on the user's own account: Generate for Coach Kah Hang **October** → `already_complete` (sealed; every
  email already sent, so the retry pass sends nothing).
- **O3 — bill the SMALLER tenant first**, per `INVOICE_RUNBOOK.md`: scoped, manual, billing month `2026-10`.
  - **Do NOT use `force`.**
  - **Do NOT bill any other month.**
  - An `incomplete_attendance` refusal is resolved only by marking or cancelling lessons, never by any bypass.
- **O4 — reconcile, then the second tenant.** ⚠ RISK 1 MITIGATION:
  - Run a read-only query of per-parent `invoice_items` + `package_applications` for October. Assertion: it equals
    O2's prediction for that tenant, and `billing_runs.duration_ms` < 150,000.
  - **A mismatch is a STOP:** do not bill the second tenant. Roll generate-invoices back to the Part A deploy sha, add
    a §9 row, and tell the user. A sealed month cannot be re-run, so any correction goes through credit notes per the
    runbook, decided by the user.
  - On a match, bill the second tenant and reconcile it the same way.
  - Read `billing_runs.duration_ms` for both tenants.
- **O5 — only if Q2 = yes (held emails).**
  1. Record `supabase secrets list`'s digest for `RESEND_API_KEY`.
  2. `supabase secrets unset RESEND_API_KEY`.
  3. Run O3/O4 (the claims release as `no_api_key`).
  4. Restore the key at once with `supabase secrets set RESEND_API_KEY=…`. Assertion: the digest equals the recorded
     one.
  5. Press Generate again for each tenant, so the retry pass sends.

  The window should be minutes: package and credit-note emails are off while it lasts.

## 7. Order and time

| Part | Estimate |
|---|---|
| Q1–Q3 + P (preflight tooling, baselines) | ~1 day |
| A (types, deploy) | ~1 day |
| B0–B10 (engine) | ~2½–3½ days (bench and mutation proofs at every stage) |
| B11–B12 (emails, with characterisation tests and branded clients) | ~¾ day |
| B13 (tests) | ~1 day |
| B14 + deploy + O1–O5 (predict, bill, reconcile) | ~1 day |

About 7–8 working days in total. October billing waits for all of it (D3). That is longer than the original 5–6
days, and is part of why Q3(a) is offered.

## 8. Not in scope

The bench harness's **layout** (P2 extends `run.ts`'s dump content only) · `bench/seed.ts` · any migration · either
app · Deno dependency vendoring (BACKLOG *Deliberately not doing*) · the *Large-month invoice emails* BACKLOG item ·
deleting the `core.ts` / `email.ts` / `runLog.ts` / `test-helpers.ts` facades (a BACKLOG item).

## 9. Bug ledger

_(empty. A bug found during the refactor is recorded here, marked **BLOCKER** if it touches October's amounts,
billed lessons, seal or recipients (§1), and fixed after Part B ships. BLOCKERs are fixed before §6 O3.)_

| # | Found | What | Blocker? |
|---|---|---|---|
| 1 | P gate, 2026-11-17 | `speed.test.ts` "invoice emails are spaced to the Resend per-second limit" failed once in a full run (`send 2 started 163 ms after the previous`, needs ≥ 190), then passed 8/8 alone and in the next full run. Pre-existing (`47996d2`); no engine code had changed. Cause (reading, not proven): `resendGate` spaces when each worker PASSES the gate, the test measures when each `fetch` STARTS; a worker resumed late after its gate pass shrinks the gap to the next. Prod cap is 2/s (500 ms spacing), so the real-world effect is a tighter gap, not a burst. Fix later: either measure the gap at the gate, or set `lastResendStart` at the fetch. | No |

**`db-any-ok` census** (A2/A3 escape hatch): **EMPTY since `types(edge): CountedQuery typed structurally`
(2026-11-18)** — the entry below is history.
- ~~`generate-invoices/core.ts:79` `CountedQuery = any`~~ — the builder `readPaged` / `readAllIn` page over, for every
  table. Typing it means threading supabase-js's PostgrestFilterBuilder generics through the §7.391 speed fix, which
  B2 keeps byte-for-byte. **Consequence, accepted:** rows read through `readPaged<T>` are typed by the hand-written
  `T`, not inferred from their select — the generated types do not check those reads (the engine's phase-1 batch).
  A later item could type `T` from each select; not in this plan.

## 10. Pre-commit gate

Walk this before **every** commit. A box that cannot be ticked is a blocker, not a caveat.

**Highest value (never skip):**
- [ ] **Part A commit:** `scripts/check-runtime-identical.sh HEAD~1 HEAD` exits 0 (P3), labelled `types(edge)`. (RISK 3, 6)
- [ ] **Part B engine commit:** bench IDENTICAL at all 4 sizes vs `47996d2`, including `resend`, `emails` and `requests`. (RISK 3, 5)
- [ ] **Query-chain census and shape censuses** unchanged vs the Part A sha. (RISK 2, 4)
- [ ] **B4/B7/B8/B9:** every guard/seal mutant went red, with test names in the commit message. (RISK 2)
- [ ] **`test.sh` ×2**, summary line = P0 (+ fence). P1's list check is green. (RISK 8)
- [ ] **Before O3:** P0 October query shows no rows · no §9 BLOCKER open · O2 prediction proven locally · Resend quota ≥ expected invoices. (RISK 1)

**Every commit:**
- [ ] `deno check` over the recursive non-test list (A4), file count printed and matching. (RISK 10)
- [ ] Fence green and the ledger only shrank. (B0)
- [ ] `check-functions-sg-date.sh`, `check-sept.sh`, `check-db-any.sh` green; `deno.lock` unchanged. (RISK 9, 10)
- [ ] `generate-invoices/index.ts` diff is import lines only (Part B). (RISK 3)
- [ ] No guard reworded, reordered, merged, given a bypass, or turned into a throw. (RISK 2)
- [ ] No `deno fmt` or template re-indent on moved code; `resendGate` state declared once. (RISK 5)
- [ ] B13 commits: engine source diff vs the B12 sha is empty; bodies identical; tenant count unchanged. (RISK 8)

**Every push to `main` / deploy:**
- [ ] `scripts/check-db-types.sh` run locally first. (RISK 9)
- [ ] Clean tree at the pushed `main` sha; rollback worktree and commands staged. (RISK 7)
- [ ] Named single-function deploys; version +1; `verify_jwt` = P0's record; boot probe passed. (RISK 7)
