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
  creditNoteIdempotencyKey,
  fetchBalances,
  fetchTenantSuspended,
  findEmailedInvoiceItemIds,
  findSpentNoteIds,
  findUnsentById,
  findUnsentBySession,
  NOTE_SELECT,
  type NoteRow,
  one,
  sendNotes,
  settleNote,
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
    const wins = [a, b].filter((r) => r.ok && r.claim !== null).length;
    assertEquals(wins, 1, "exactly one caller may claim a note");
  } finally {
    await s.teardown();
  }
});

/** The note's two email columns and its SQL-computed state. */
async function emailCols(s: Scenario, noteId: string) {
  const { data } = await s.db
    .from("credit_notes")
    .select("email_sent_at, email_claimed_at, credit_note_email_state")
    .eq("id", noteId)
    .single();
  return data as {
    email_sent_at: string | null;
    email_claimed_at: string | null;
    credit_note_email_state: string;
  };
}

/** Age the claim as if its sender died `minutes` ago (service_role is not pinned). */
async function ageClaim(s: Scenario, noteId: string, minutes: number) {
  const { error } = await s.db
    .from("credit_notes")
    .update({ email_claimed_at: new Date(Date.now() - minutes * 60_000).toISOString() })
    .eq("id", noteId);
  if (error) throw new Error(`fixture: could not age the claim — ${error.message}`);
}

Deno.test("a claimed note is no longer discoverable; releasing restores it", async () => {
  const { s, sessionId, note } = await scenarioWithCreditNote();
  try {
    const claimed = await claimNote(s.db, note.id);
    assert(claimed.ok && claimed.claim);

    const afterClaim = await findUnsentBySession(s.db, sessionId, s.tenantId);
    assert(afterClaim.ok);
    assertEquals(afterClaim.notes.length, 0, "a note mid-send (SENDING) is not a candidate");
    assertEquals((await emailCols(s, note.id)).email_sent_at, null, "a claim is NOT a sent stamp");

    await settleNote(s.db, note.id, claimed.claim.claimedAt, "release");
    const afterRelease = await findUnsentBySession(s.db, sessionId, s.tenantId);
    assert(afterRelease.ok);
    assertEquals(afterRelease.notes.length, 1, "release makes it resendable");
  } finally {
    await s.teardown();
  }
});

Deno.test("findUnsentById hides a FRESH claim (sending) and returns an EXPIRED one", async () => {
  const { s, note } = await scenarioWithCreditNote();
  try {
    const before = await findUnsentById(s.db, note.id);
    assert(before.ok);
    assertEquals(before.notes.length, 1);

    await claimNote(s.db, note.id);

    // This is what stops a second press of Resend re-sending while one is in flight.
    const fresh = await findUnsentById(s.db, note.id);
    assert(fresh.ok);
    assertEquals(fresh.notes.length, 0);
    assert(fresh.sending, "reported as sending, not as already emailed");

    // The sender died: 20 minutes on, the lease has expired and a human can resend.
    await ageClaim(s, note.id, 20);
    const expired = await findUnsentById(s.db, note.id);
    assert(expired.ok);
    assertEquals(expired.notes.length, 1, "an expired claim is resendable — it no longer strands");
    assertEquals(expired.notes[0].credit_note_email_state, "RETRYABLE");
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

    // A CONFIRMED send is what "emailed" means — a claim alone is not.
    const claimed = await claimNote(s.db, note.id);
    assert(claimed.ok && claimed.claim);
    const mid = await findEmailedInvoiceItemIds(s.db, [note.invoice_item_id]);
    assert(mid.ok);
    assertEquals(mid.items.size, 0, "a claim in flight has not emailed the line");
    await settleNote(s.db, note.id, claimed.claim.claimedAt, "sent");

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

// The double-credit bug (BACKLOG.md Wave D) is FIXED by 20260818000100: a re-toggled
// correction now REUSES one credit_notes row per invoice line (absent->present voids it,
// present->absent re-activates the SAME row) instead of minting a second note. So the
// email side trivially announces the one line once.
Deno.test("⚠ RISK 5: a re-toggled correction reuses ONE note on the line; one email", async () => {
  const { s, sessionId, note } = await scenarioWithCreditNote();
  try {
    // absent -> present VOIDS the note; present -> absent re-activates the SAME row.
    await s.mark(sessionId, "present");
    await s.mark(sessionId, "absent");

    const found = await findUnsentBySession(s.db, sessionId, s.tenantId);
    assert(found.ok);
    assertEquals(found.notes.length, 1, "the fix reuses one note per invoice line");
    assertEquals(
      found.notes[0].invoice_item_id,
      note.invoice_item_id,
      "the reused note sits on the same invoice line",
    );

    // Walk it the way index.ts does: claim, record the line, then re-decide.
    const emailedItems = new Set<string>();
    const spent = new Set<string>();
    let would = 0;
    for (const n of found.notes) {
      if (skipReasonFor(n, { spent, emailedItems })) continue;
      const claim = await claimNote(s.db, n.id);
      if (!(claim.ok && claim.claim)) continue;
      emailedItems.add(n.invoice_item_id);
      would++;
    }
    assertEquals(would, 1, "one invoice line, one email — ever");
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

// ── Item 3 — a REVERSED draw is not spent (a voided note becomes sendable) ───

Deno.test("Item 3: a note whose draws are all REVERSED is NOT reported spent", async () => {
  const { s, note } = await scenarioWithCreditNote();
  try {
    // Draw the credit down for real, exactly as ⚠ RISK 2 does.
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

    // Pre-condition: it IS spent while the draw is live.
    const before = await findSpentNoteIds(s.db, [note.id]);
    assert(before.ok && before.spent.has(note.id), "live draw ⇒ spent");

    // A void marks the draw reversed (void_credit_note does this; here we set the
    // column directly — the Deno client is service_role, not a tenant admin).
    await s.db
      .from("credit_applications")
      .update({ reversed_at: new Date().toISOString() })
      .eq("credit_note_id", note.id);

    // Now it is NOT spent — the re-issued credit can email again. RED against the
    // pre-Item-3 findSpentNoteIds, which counted the reversed row.
    const after = await findSpentNoteIds(s.db, [note.id]);
    assert(after.ok, "query ok");
    assert(
      !after.spent.has(note.id),
      "a note with only reversed draws is not spent",
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

Deno.test("⚠ RISK 8: a THROWING send is never stamped sent, and heals when its lease expires", async () => {
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

    // A throw may have been delivered (a timeout after Resend accepted), so the
    // claim is KEPT — but email_sent_at is not stamped, so nothing renders "Emailed".
    const cols = await emailCols(s, note.id);
    assertEquals(cols.email_sent_at, null, "a throw must never stamp the note as emailed");
    assertEquals(cols.credit_note_email_state, "SENDING");

    // Before 20260927000100 this was the stuck state: kept claim == sent marker,
    // no Resend button, no retry pass. Now the lease expires and it is resendable.
    await ageClaim(s, note.id, 20);
    const found = await findUnsentById(s.db, note.id);
    assert(found.ok);
    assertEquals(found.notes.length, 1, "15 minutes on, the admin's Resend can reach it");
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
    const afterFive = await emailCols(s, note.id);
    assert(
      afterFive.email_claimed_at !== null,
      "a 5xx must KEEP the claim — releasing it is how a parent gets a duplicate",
    );
    assertEquals(afterFive.email_sent_at, null, "…but it is not a confirmed send");

    // Reset for the second half.
    await s.db.from("credit_notes").update({ email_claimed_at: null }).eq("id", note.id);

    // 4xx — Resend refused, nothing sent, so it must become resendable.
    await sendNotes(s.db, [note], { spent: new Set(), emailedItems: new Set() }, {
      send: () => Promise.resolve({ sent: false, outcome: "rejected", reason: "422" }),
      balances,
    });
    const afterFour = await emailCols(s, note.id);
    assertEquals(afterFour.email_claimed_at, null, "a 4xx released the claim");
    assertEquals(afterFour.credit_note_email_state, "UNSENT");
  } finally {
    await s.teardown();
  }
});

// ── The crash-safe claim (CRASH_SAFE_EMAIL_CLAIM_PLAN.md §3.2) ───────────────

Deno.test("claim: every send carries the key credit-note/<id>/<issued_at epoch>", async () => {
  const { s, note } = await scenarioWithCreditNote();
  try {
    const keys: string[] = [];
    await sendNotes(s.db, [note], { spent: new Set(), emailedItems: new Set() }, {
      send: (_d, _to, key) => {
        keys.push(key);
        return Promise.resolve({ sent: true, outcome: "ok" } as SendResult);
      },
      balances: new Map(),
    });
    const { data } = await s.db.from("credit_notes").select("issued_at").eq("id", note.id).single();
    const issuedAt = (data as { issued_at: string }).issued_at;
    assertEquals(keys, [`credit-note/${note.id}/${Date.parse(issuedAt)}`]);
  } finally {
    await s.teardown();
  }
});

Deno.test("claim: a note claimed > 24 h ago is never auto-sent; a human Resend reuses its key", async () => {
  const { s, sessionId, note } = await scenarioWithCreditNote();
  try {
    await claimNote(s.db, note.id);
    await ageClaim(s, note.id, 25 * 60);
    assertEquals((await emailCols(s, note.id)).credit_note_email_state, "MAY_HAVE_SENT");

    // The coach's re-save path does not even see it…
    const bySession = await findUnsentBySession(s.db, sessionId, s.tenantId);
    assert(bySession.ok);
    assertEquals(bySession.notes.length, 0, "an unknown outcome past 24 h is a human decision");

    // …and an automatic (non-manual) send cannot claim it either.
    const byId = await findUnsentById(s.db, note.id);
    assert(byId.ok && byId.notes.length === 1, "the admin's lookup DOES find it");
    const keys: string[] = [];
    const send = (_d: unknown, _to: unknown, key: string) => {
      keys.push(key);
      return Promise.resolve({ sent: true, outcome: "ok" } as SendResult);
    };
    const auto = await sendNotes(s.db, byId.notes, { spent: new Set(), emailedItems: new Set() }, {
      send: send as never, balances: new Map(),
    });
    assertEquals(auto.sent, 0);
    assertEquals(keys.length, 0);

    // The admin presses "Resend anyway": manual, under the note's ONE key — lapsed
    // by now, so Resend sends fresh, and a later coach re-save would dedup on it.
    const manual = await sendNotes(s.db, byId.notes, { spent: new Set(), emailedItems: new Set() }, {
      send: send as never, balances: new Map(), manual: true,
    });
    assertEquals(manual.sent, 1);
    assertEquals(keys.length, 1);
    const { data: issued } = await s.db.from("credit_notes").select("issued_at").eq("id", note.id).single();
    assertEquals(keys[0], `credit-note/${note.id}/${Date.parse((issued as { issued_at: string }).issued_at)}`);
    assertEquals((await emailCols(s, note.id)).credit_note_email_state, "SENT");
  } finally {
    await s.teardown();
  }
});

Deno.test("claim: a note RE-ISSUED mid-send is not stamped by the stale sender", async () => {
  // The re-issue reuses the same row with a new issued_at; its trigger clears
  // the claim. The in-flight sender's settle is conditional on its token, so it
  // matches nothing — and the re-issued credit is announced afresh, under a new key.
  const { s, sessionId, note } = await scenarioWithCreditNote();
  try {
    const claimed = await claimNote(s.db, note.id);
    assert(claimed.ok && claimed.claim);
    const firstKey = creditNoteIdempotencyKey(note.id, claimed.claim);

    await s.mark(sessionId, "present"); // voids
    await s.mark(sessionId, "absent");  // re-issues the SAME row, new issued_at

    await settleNote(s.db, note.id, claimed.claim.claimedAt, "sent");
    const cols = await emailCols(s, note.id);
    assertEquals(cols.email_sent_at, null, "the stale sender must not mark the re-issue emailed");
    assertEquals(cols.credit_note_email_state, "UNSENT");

    const again = await claimNote(s.db, note.id);
    assert(again.ok && again.claim);
    assert(
      creditNoteIdempotencyKey(note.id, again.claim) !== firstKey,
      "a re-issued note is a NEW email — the key is versioned by issued_at",
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

    const cols = await emailCols(s, note.id);
    assert(cols.email_sent_at !== null, "a confirmed send stamps email_sent_at");
    assertEquals(cols.email_claimed_at, null, "and clears the claim");
  } finally {
    await s.teardown();
  }
});

Deno.test("⚠ RISK 5: the reused note sends once; the dedup still guards a same-line pair", async () => {
  const { s, sessionId } = await scenarioWithCreditNote();
  try {
    // The fix leaves ONE note on the line after a re-toggle.
    await s.mark(sessionId, "present");
    await s.mark(sessionId, "absent");
    const found = await findUnsentBySession(s.db, sessionId, s.tenantId);
    assert(found.ok);
    assertEquals(found.notes.length, 1, "one note per line (double-credit fixed)");

    const stub = stubSender(() => ({ sent: true, outcome: "ok" }));
    const res = await sendNotes(
      s.db,
      found.notes,
      { spent: new Set(), emailedItems: new Set() },
      { send: stub.send as never, balances: new Map() },
    );
    assertEquals(res.sent, 1, "one invoice line, one email");
    assertEquals(stub.calls.length, 1, "the sender was invoked exactly once");
    assertEquals(res.firstSkip, null, "nothing to skip — there is only one note");

    // Defense in depth: UNIQUE(invoice_item_id) now forbids two unsent notes on one
    // line, but skipReasonFor must still refuse a second were one ever constructed.
    const twin = { ...found.notes[0], id: crypto.randomUUID() };
    assertEquals(
      skipReasonFor(twin, {
        spent: new Set(),
        emailedItems: new Set([found.notes[0].invoice_item_id]),
      }),
      "invoice-line-already-emailed",
    );
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
