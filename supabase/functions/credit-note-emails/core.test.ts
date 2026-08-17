// Integration tests for the credit-note-emails DATABASE pipeline.
//
// Plan: docs/plans/CREDIT_NOTE_EMAIL_PLAN.md. email.test.ts covers the pure deciders;
// this file covers the half that only a real Postgres can answer — the tenant filter,
// the sibling dedupe, and whether two concurrent claims can both win.
//
// ⚠ RISK 14 — EVERY credit note here is created by driving the
// handle_attendance_update TRIGGER (mark an invoiced lesson absent), never by
// INSERTing one. The local credit_notes table starts empty, so a hand-inserted
// fixture would prove nothing about the path that actually fires in production —
// it would skip the package-application early return, the reference-number
// generation and the balance update all at once. requireNote() below turns a
// fixture that produced no row into a hard error rather than a quiet pass, the same
// rule newScenario() enforces for vacuous billing windows.

import { assert, assertEquals } from "jsr:@std/assert@1";
import {
  claimNote,
  fetchBalances,
  fetchTenantSuspended,
  findEmailedInvoiceItemIds,
  findSpentNoteIds,
  findUnsentById,
  findUnsentBySession,
  NOTE_SELECT,
  type NoteRow,
  one,
  releaseNote,
  sendNotes,
  skipReasonFor,
} from "./core.ts";
import type { SendResult } from "./email.ts";
import { generateInvoices } from "../generate-invoices/core.ts";
import {
  monthEnded,
  newScenario,
  type Scenario,
} from "../generate-invoices/test-helpers.ts";

/**
 * Bill a month, then correct one invoiced lesson to absent so the trigger issues a
 * real credit note. Returns the scenario, the corrected session, and the note.
 */
async function scenarioWithCreditNote(): Promise<{
  s: Scenario;
  sessionId: string;
  note: NoteRow;
}> {
  const s = await newScenario({ price: 30, billing: monthEnded("2026-06") });
  // ⚠ EVERYTHING AFTER newScenario() MUST BE INSIDE THIS try.
  //
  // A scenario is a live tenant + coach + parent + invoices in a SHARED database.
  // The caller wraps its own body in try/finally { s.teardown() }, but that only
  // starts protecting once this function RETURNS — so a throw in here leaks the whole
  // fixture, and nothing ever cleans it up.
  //
  // This is not hypothetical. It cost real time on 2026-08-17: proving requireNote()
  // red (by removing the correction below) made all 9 tests throw HERE, leaking 9
  // tenants each holding a 2026-05 invoice. That then broke
  // supabase/tests/tenant_isolation.test.sql test 18, which asserts
  // `SELECT COUNT(*) FROM invoices` = 2 GLOBALLY — a pgTAP failure with no visible
  // connection to the Deno suite that caused it. Debugging that from the pgTAP end
  // is nearly impossible.
  try {
    const j1 = await s.addSession("2026-05-02");
    await s.mark(j1, "present");
    const j2 = await s.addSession("2026-05-09");
    await s.mark(j2, "present");
    await s.completeMonth("2026-05");
    await generateInvoices(s.db, {
      tenant_id: s.tenantId,
      mode: "manual",
      force: true,
      billing_month: "2026-05",
      now: s.now,
    });

    // THE TRIGGER, not an INSERT (⚠ RISK 14).
    await s.mark(j1, "absent");

    const note = await requireNote(s, j1);
    return { s, sessionId: j1, note };
  } catch (e) {
    // Hand the fixture back before rethrowing. teardown() throws if something still
    // references the tenant, which would mask the original error — so its own failure
    // is folded into the message rather than replacing it.
    try {
      await s.teardown();
    } catch (teardownErr) {
      throw new Error(
        `${(e as Error).message}\n  [and teardown of tenant ${s.tenantId} then failed: ` +
          `${(teardownErr as Error).message} — that tenant is now orphaned in the shared DB ` +
          `and will break tenant_isolation test 18 until it is removed]`,
      );
    }
    throw e;
  }
}

/** ⚠ RISK 14 — a fixture that produced no credit note is an error, not a pass. */
async function requireNote(s: Scenario, sessionId: string): Promise<NoteRow> {
  const res = await findUnsentBySession(s.db, sessionId, s.tenantId);
  assert(res.ok, `fixture: discovery failed — ${res.ok ? "" : res.reason}`);
  if (!res.notes.length) {
    throw new Error(
      "vacuous fixture — marking an invoiced lesson absent produced NO credit note. " +
        "The trigger's conditions were not met (package-funded line? status unchanged? " +
        "no invoice_item for the lesson?), so this test would pass by having nothing " +
        "to check. Fix the fixture, not the assertion.",
    );
  }
  return res.notes[0];
}

Deno.test("the trigger issues a discoverable, unsent credit note", async () => {
  const { s, note } = await scenarioWithCreditNote();
  try {
    assertEquals(Number(note.amount), 30);
    assertEquals(note.status, "available");
    assertEquals(note.applied_to_invoice_id, null);
    assert(note.reference_number.length > 0, "the trigger generates a reference");
    // ⚠ RISK 6 — the snapshot fields the email is built from are populated.
    const item = one<{ class_title: string; session_date: string }>(note.invoice_items);
    assertEquals(item?.session_date, "2026-05-02");
    assert(item?.class_title, "invoice_items.class_title snapshot is present");
    assert(note.student_name, "credit_notes.student_name snapshot is present");
  } finally {
    await s.teardown();
  }
});

// ── ⚠ RISK 3 — the tenant filter ────────────────────────────────────────────

Deno.test("⚠ RISK 3: a note is invisible when queried under the WRONG tenant", async () => {
  const { s, sessionId } = await scenarioWithCreditNote();
  const other = await newScenario({ price: 30, billing: monthEnded("2026-06") });
  try {
    // Same session, a different tenant's id. service_role bypasses RLS, so if this
    // returned the row, one business could email about another's credit note.
    const wrong = await findUnsentBySession(s.db, sessionId, other.tenantId);
    assert(wrong.ok);
    assertEquals(wrong.notes.length, 0);

    // The right tenant still sees it — proving the zero above is the filter, not an
    // empty table.
    const right = await findUnsentBySession(s.db, sessionId, s.tenantId);
    assert(right.ok);
    assertEquals(right.notes.length, 1);
  } finally {
    // allSettled, NOT sequential awaits: teardown() throws if anything still
    // references its tenant, and a throw from the first would skip the second
    // entirely — leaking a tenant into the shared DB and breaking
    // tenant_isolation test 18 with no visible connection to this suite. That is
    // the exact trap this file's header documents; do not "simplify" this back.
    await Promise.allSettled([s.teardown(), other.teardown()]);
  }
});

// ── The claim ───────────────────────────────────────────────────────────────

Deno.test("the claim is atomic: of two racing claims exactly ONE wins", async () => {
  const { s, note } = await scenarioWithCreditNote();
  try {
    const [a, b] = await Promise.all([
      claimNote(s.db, note.id),
      claimNote(s.db, note.id),
    ]);
    assert(a.ok && b.ok);
    const wins = [a, b].filter((r) => r.ok && r.claimed).length;
    assertEquals(wins, 1, "exactly one caller may claim a note");
  } finally {
    await s.teardown();
  }
});

Deno.test("a claimed note is no longer discoverable; releasing restores it", async () => {
  const { s, sessionId, note } = await scenarioWithCreditNote();
  try {
    const claim = await claimNote(s.db, note.id);
    assert(claim.ok && claim.claimed);

    const afterClaim = await findUnsentBySession(s.db, sessionId, s.tenantId);
    assert(afterClaim.ok);
    assertEquals(afterClaim.notes.length, 0, "a claimed note is stamped, so unsent-only misses it");

    await releaseNote(s.db, note.id);
    const afterRelease = await findUnsentBySession(s.db, sessionId, s.tenantId);
    assert(afterRelease.ok);
    assertEquals(afterRelease.notes.length, 1, "release makes it resendable");
  } finally {
    await s.teardown();
  }
});

Deno.test("findUnsentById returns nothing for an already-claimed note", async () => {
  const { s, note } = await scenarioWithCreditNote();
  try {
    const before = await findUnsentById(s.db, note.id);
    assert(before.ok);
    assertEquals(before.notes.length, 1);

    await claimNote(s.db, note.id);

    // This is what stops a second press of Resend re-sending.
    const after = await findUnsentById(s.db, note.id);
    assert(after.ok);
    assertEquals(after.notes.length, 0);
  } finally {
    await s.teardown();
  }
});

// ── ⚠ RISK 5 — one email per invoice line ───────────────────────────────────

Deno.test("⚠ RISK 5: an emailed invoice line is reported, so a sibling note is skipped", async () => {
  const { s, note } = await scenarioWithCreditNote();
  try {
    // Nothing emailed yet.
    const before = await findEmailedInvoiceItemIds(s.db, [note.invoice_item_id]);
    assert(before.ok);
    assertEquals(before.items.size, 0);

    await claimNote(s.db, note.id); // stamping is what "emailed" means

    const after = await findEmailedInvoiceItemIds(s.db, [note.invoice_item_id]);
    assert(after.ok);
    assert(after.items.has(note.invoice_item_id));

    // And the pure decider refuses on that basis.
    assertEquals(
      skipReasonFor(note, { spent: new Set(), emailedItems: after.items }),
      "invoice-line-already-emailed",
    );
  } finally {
    await s.teardown();
  }
});

// The double-credit bug itself (BACKLOG.md): re-correcting the SAME lesson issues a
// second note on the same invoice line. This pins that the EMAIL never announces it
// twice, which is the guarantee the plan actually makes.
Deno.test("⚠ RISK 5: a re-toggled correction makes TWO notes on one line; only one may email", async () => {
  const { s, sessionId, note } = await scenarioWithCreditNote();
  try {
    // absent -> present reverses nothing, then present -> absent issues note #2.
    await s.mark(sessionId, "present");
    await s.mark(sessionId, "absent");

    const both = await findUnsentBySession(s.db, sessionId, s.tenantId);
    assert(both.ok);
    assertEquals(both.notes.length, 2, "the trigger really does issue a second note");
    assertEquals(
      both.notes[0].invoice_item_id,
      both.notes[1].invoice_item_id,
      "and both sit on the SAME invoice line — the double-credit bug",
    );

    // Now walk them the way index.ts does: claim, record the line, then re-decide.
    const emailedItems = new Set<string>();
    const spent = new Set<string>();
    let would = 0;
    for (const n of both.notes) {
      if (skipReasonFor(n, { spent, emailedItems })) continue;
      const claim = await claimNote(s.db, n.id);
      if (!(claim.ok && claim.claimed)) continue;
      emailedItems.add(n.invoice_item_id);
      would++;
    }
    assertEquals(would, 1, "one invoice line, one email — ever");
    void note;
  } finally {
    await s.teardown();
  }
});

// ── ⚠ RISK 2 — spent notes ──────────────────────────────────────────────────

Deno.test("⚠ RISK 2: once the credit is applied, the note is reported spent and refused", async () => {
  const { s, note } = await scenarioWithCreditNote();
  try {
    // Bill the NEXT month so the engine draws the credit down for real.
    const f1 = await s.addSession("2026-06-06");
    await s.mark(f1, "present");
    await s.completeMonth("2026-06");
    await generateInvoices(s.db, {
      tenant_id: s.tenantId,
      mode: "manual",
      force: true,
      billing_month: "2026-06",
      now: s.now,
    });

    const spentRes = await findSpentNoteIds(s.db, [note.id]);
    assert(spentRes.ok);
    assert(
      spentRes.spent.has(note.id),
      "a drawn-down note has a credit_applications row",
    );

    // Re-read it: the engine has moved status/applied_to_invoice_id too.
    const fresh = await findUnsentById(s.db, note.id);
    assert(fresh.ok);
    // Asserted UNCONDITIONALLY. Wrapping this in `if (fresh.notes.length)` let the
    // whole check evaporate the day the engine also stamps or hides the row — and
    // the findSpentNoteIds assertion above would still pass, masking the loss of the
    // #2-ranked refusal.
    assertEquals(fresh.notes.length, 1, "the applied note is still discoverable as unsent");
    assertEquals(
      skipReasonFor(fresh.notes[0], { spent: spentRes.spent, emailedItems: new Set() }),
      "already-applied",
    );
  } finally {
    await s.teardown();
  }
});

// ── ⚠ RISK 11 — the balance is a per-(parent, tenant) aggregate ─────────────

Deno.test("⚠ RISK 11: the balance is the parent's TOTAL with that business, not the note", async () => {
  const { s, sessionId, note } = await scenarioWithCreditNote();
  try {
    // Credit a second lesson: one parent, one business, two $30 notes.
    await s.mark(await sessionOf(s, "2026-05-09"), "absent");

    const balances = await fetchBalances(s.db, s.tenantId, [note.parent_id]);
    assertEquals(
      balances.get(note.parent_id),
      60,
      "two $30 notes aggregate to a $60 balance — which is why the email labels " +
        "'this credit note' and 'total credit with X' separately",
    );
    assertEquals(Number(note.amount), 30, "while the note itself is still $30");
    void sessionId;
  } finally {
    await s.teardown();
  }
});

// ── ⚠ RISK 10 — the suspension gate. THIS IS THE TEST THAT WAS MISSING ──────
//
// The gate shipped FAILING OPEN: index.ts called the tenant_suspended() RPC with the
// service client, which holds no EXECUTE on it, discarded the error, and read the
// resulting null as "not suspended" — on every invocation. No test could see it
// because the gate lived in the Deno.serve closure. It now lives in core.ts and this
// runs it.

Deno.test("⚠ RISK 10: fetchTenantSuspended reports a LIVE business as not suspended", async () => {
  const s = await newScenario({ price: 30, billing: monthEnded("2026-06") });
  try {
    assertEquals(await fetchTenantSuspended(s.db, s.tenantId), false);
  } finally {
    await s.teardown();
  }
});

Deno.test("⚠ RISK 10: fetchTenantSuspended reports a SUSPENDED business as suspended", async () => {
  const s = await newScenario({ price: 30, billing: monthEnded("2026-06") });
  try {
    await s.db.from("tenants")
      .update({ suspended_at: new Date().toISOString() })
      .eq("id", s.tenantId);
    assertEquals(
      await fetchTenantSuspended(s.db, s.tenantId),
      true,
      "a suspended business must never be emailed in — this is the assertion the " +
        "RPC form could not make, because it failed open",
    );
  } finally {
    await s.db.from("tenants").update({ suspended_at: null }).eq("id", s.tenantId);
    await s.teardown();
  }
});

Deno.test("⚠ RISK 10: an unknown tenant FAILS CLOSED (null, not false)", async () => {
  const s = await newScenario({ price: 30, billing: monthEnded("2026-06") });
  try {
    assertEquals(
      await fetchTenantSuspended(s.db, "00000000-0000-0000-0000-000000000000"),
      null,
      "null means 'could not tell', which the caller must treat as do-not-send",
    );
  } finally {
    await s.teardown();
  }
});

// ── ⚠ RISK 8 and ⚠ RISK 12 — the claim/release loop, now reachable ──────────

/** A sender that records what it was asked to send and answers however the test says. */
function stubSender(answer: (n: number) => SendResult | Promise<never>) {
  const calls: { to: string | undefined; reference: string }[] = [];
  return {
    calls,
    send: (data: { referenceNumber: string }, to: string | undefined) => {
      calls.push({ to, reference: data.referenceNumber });
      return Promise.resolve(answer(calls.length)) as Promise<SendResult>;
    },
  };
}

Deno.test("⚠ RISK 8: a THROWING send leaves email_sent_at NULL, not stamped", async () => {
  const { s, note } = await scenarioWithCreditNote();
  try {
    const stub = {
      send: () => Promise.reject(new Error("boom mid-send")),
    };
    const res = await sendNotes(
      s.db,
      [note],
      { spent: new Set(), emailedItems: new Set() },
      { send: stub.send as never, balances: new Map([[note.parent_id, 30]]) },
    );
    assertEquals(res.sent, 0);

    // The whole point: the row must be resendable, not silently stamped-as-emailed.
    const { data } = await s.db
      .from("credit_notes").select("email_sent_at").eq("id", note.id).maybeSingle();
    assertEquals(
      (data as { email_sent_at: string | null }).email_sent_at,
      null,
      "a throw after a successful claim MUST release it — otherwise the note renders " +
        "'Emailed', Resend cannot reach it, and there is no automatic retry pass",
    );
  } finally {
    await s.teardown();
  }
});

Deno.test("⚠ RISK 7: a 5xx KEEPS the claim; a 4xx releases it", async () => {
  const { s, note } = await scenarioWithCreditNote();
  try {
    const balances = new Map([[note.parent_id, 30]]);

    // 5xx — may already have been delivered, so the claim must stand.
    await sendNotes(s.db, [note], { spent: new Set(), emailedItems: new Set() }, {
      send: () => Promise.resolve({ sent: false, outcome: "server_error", reason: "503" }),
      balances,
    });
    const { data: afterFive } = await s.db
      .from("credit_notes").select("email_sent_at").eq("id", note.id).maybeSingle();
    assert(
      (afterFive as { email_sent_at: string | null }).email_sent_at !== null,
      "a 5xx must KEEP the claim — releasing it is how a parent gets a duplicate",
    );

    await releaseNote(s.db, note.id); // reset for the second half

    // 4xx — Resend refused, nothing sent, so it must become resendable.
    await sendNotes(s.db, [note], { spent: new Set(), emailedItems: new Set() }, {
      send: () => Promise.resolve({ sent: false, outcome: "rejected", reason: "422" }),
      balances,
    });
    const { data: afterFour } = await s.db
      .from("credit_notes").select("email_sent_at").eq("id", note.id).maybeSingle();
    assertEquals(
      (afterFour as { email_sent_at: string | null }).email_sent_at,
      null,
      "a 4xx released the claim",
    );
  } finally {
    await s.teardown();
  }
});

Deno.test("⚠ RISK 12: note #1 throwing still sends notes #2..N", async () => {
  const { s, sessionId, note } = await scenarioWithCreditNote();
  try {
    // A second note on a DIFFERENT lesson, so RISK 5's line-dedupe does not skip it.
    // findUnsentBySession is scoped to ONE lesson_session_id by design (⚠ RISK 3), so
    // the two notes must be collected per session and concatenated — querying only
    // the first session returns one note and the fixture assertion below catches it.
    const secondSession = await sessionOf(s, "2026-05-09");
    await s.mark(secondSession, "absent");
    const [first, second] = await Promise.all([
      findUnsentBySession(s.db, sessionId, s.tenantId),
      findUnsentBySession(s.db, secondSession, s.tenantId),
    ]);
    assert(first.ok && second.ok);
    const all = { ok: true as const, notes: [...first.notes, ...second.notes] };
    assertEquals(all.notes.length, 2, "fixture: two notes on two different lessons");
    assert(
      all.notes[0].invoice_item_id !== all.notes[1].invoice_item_id,
      "fixture: the two notes must be on different invoice lines",
    );

    let n = 0;
    const res = await sendNotes(
      s.db,
      all.notes,
      { spent: new Set(), emailedItems: new Set() },
      {
        send: () => {
          n++;
          if (n === 1) return Promise.reject(new Error("first one explodes"));
          return Promise.resolve({ sent: true, outcome: "ok" } as SendResult);
        },
        balances: new Map([[note.parent_id, 60]]),
      },
    );
    assertEquals(
      res.sent,
      1,
      "the second note still sent — one try/catch PER note, inside the loop",
    );
  } finally {
    await s.teardown();
  }
});

Deno.test("a successful send STAMPS the note and reports it", async () => {
  const { s, note } = await scenarioWithCreditNote();
  try {
    const stub = stubSender(() => ({ sent: true, outcome: "ok" }));
    const res = await sendNotes(
      s.db,
      [note],
      { spent: new Set(), emailedItems: new Set() },
      { send: stub.send as never, balances: new Map([[note.parent_id, 30]]) },
    );
    assertEquals(res.sent, 1);
    assertEquals(stub.calls.length, 1);
    assertEquals(stub.calls[0].reference, note.reference_number);
    assert(stub.calls[0].to, "the parent's email was resolved from the snapshot join");

    const { data } = await s.db
      .from("credit_notes").select("email_sent_at").eq("id", note.id).maybeSingle();
    assert((data as { email_sent_at: string | null }).email_sent_at !== null);
  } finally {
    await s.teardown();
  }
});

Deno.test("⚠ RISK 5: two notes on ONE invoice line produce exactly ONE send", async () => {
  const { s, sessionId } = await scenarioWithCreditNote();
  try {
    // Re-toggle the SAME lesson: a second note on the same invoice line.
    await s.mark(sessionId, "present");
    await s.mark(sessionId, "absent");
    const both = await findUnsentBySession(s.db, sessionId, s.tenantId);
    assert(both.ok);
    assertEquals(both.notes.length, 2);
    assertEquals(both.notes[0].invoice_item_id, both.notes[1].invoice_item_id);

    const stub = stubSender(() => ({ sent: true, outcome: "ok" }));
    const res = await sendNotes(
      s.db,
      both.notes,
      { spent: new Set(), emailedItems: new Set() },
      { send: stub.send as never, balances: new Map() },
    );
    assertEquals(res.sent, 1, "one invoice line, one email");
    assertEquals(stub.calls.length, 1, "the sender was invoked exactly once");
    assertEquals(res.firstSkip, "invoice-line-already-emailed");
  } finally {
    await s.teardown();
  }
});

// ── ⚠ RISK 6 — the snapshot, pinned against a REAL rename ───────────────────
//
// The previous version of this assertion lived in email.test.ts and only proved the
// builder interpolates its own argument — true regardless of the implementation. The
// risk is that the QUERY reads a live join, so the test has to rename the child and
// re-read through NOTE_SELECT.

Deno.test("⚠ RISK 6: renaming the child does NOT change what the email will say", async () => {
  const { s, sessionId, note } = await scenarioWithCreditNote();
  try {
    const before = note.student_name;
    assert(before, "fixture: the note carries a name snapshot");

    await s.db.from("students")
      .update({ full_name: "COMPLETELY DIFFERENT NAME" })
      .eq("id", s.studentId);

    const after = await findUnsentBySession(s.db, sessionId, s.tenantId);
    assert(after.ok);
    assertEquals(
      after.notes[0].student_name,
      before,
      "§7.155 — a resend weeks later must render what the INVOICE said, not the " +
        "current record; the parent is holding the invoice that disagrees",
    );
    const item = one<{ class_title: string }>(after.notes[0].invoice_items);
    assert(item?.class_title, "and the class title is the invoice's snapshot too");
  } finally {
    await s.teardown();
  }
});

Deno.test("⚠ RISK 6: NOTE_SELECT contains no live-name joins", () => {
  // Structural: the prohibition is machine-checked, not just commented.
  for (const forbidden of ["students(", "classes(", "lesson_sessions("]) {
    assert(
      !NOTE_SELECT.includes(forbidden),
      `NOTE_SELECT must not join ${forbidden} — snapshots only (§7.155)`,
    );
  }
});

/** The lesson_session id for a date already added to this scenario. */
async function sessionOf(s: Scenario, date: string): Promise<string> {
  const { data } = await s.db
    .from("lesson_sessions")
    .select("id, class_id, classes!inner(tenant_id)")
    .eq("session_date", date)
    .eq("classes.tenant_id", s.tenantId)
    .limit(1)
    .maybeSingle();
  const id = (data as { id?: string } | null)?.id;
  if (!id) throw new Error(`fixture: no lesson_session on ${date} for this tenant`);
  return id;
}
