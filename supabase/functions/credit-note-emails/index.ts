// credit-note-emails — best-effort credit-note notifications, caller-authorized.
//
// POST { lesson_session_id: UUID }   — the COACH path, after an attendance save.
// POST { credit_note_id:   UUID }    — the ADMIN RESEND path, from the Credit Notes page.
//
// Plan: docs/plans/CREDIT_NOTE_EMAIL_PLAN.md.
//
// THIS FILE IS DELIBERATELY THIN: parse, authorize, delegate. Everything that can be
// got wrong lives in core.ts (integration-tested) or email.ts (unit-tested). That
// split is not tidiness — the RISK 10 suspension gate shipped FAILING OPEN precisely
// because it lived in this closure, where no test could reach it.
//
// WHY AN EDGE FUNCTION AND NOT THE TRIGGER. Credit notes are issued by the
// handle_attendance_update Postgres trigger, so there is no natural server-side send
// point. The backlog proposed pg_net from inside that trigger, or a Supabase DB
// webhook; both were rejected. pg_net would put network latency and failure inside a
// SECURITY DEFINER trigger running in the attendance write's own transaction — on the
// billing path — and it is cloud-only, so the whole send path would ship having never
// run on the local stack. A DB webhook is dashboard config rather than a migration:
// invisible to the repo, unreproducible locally, and its replay semantics would become
// load-bearing while untestable. The coach app calling a function is the pattern
// ../package-emails already established here.
//
// AUTHORIZATION: verify_jwt is ON (no config.toml entry — package-emails has none and
// it defaults ON), so Supabase has already validated the caller's JWT. Each path then
// re-checks the caller against the row, AS THE CALLER, via their own JWT on an anon
// client. The service client bypasses RLS, so these checks plus core.ts's tenant
// filter are the whole boundary.
//
// Best-effort by contract, same as package-emails: every failure returns 200 with
// {sent:0} and a reason. An attendance save, and the credit note itself, must never
// look failed because an email was.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  fetchBalances,
  fetchTenantSuspended,
  findEmailedInvoiceItemIds,
  findSpentNoteIds,
  findUnsentById,
  findUnsentBySession,
  resendSender,
  sendNotes,
} from "./core.ts";
import { authorizeCreditNoteEmail, canEmailForTenant } from "./email.ts";

Deno.serve(async (req) => {
  const respond = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { "Content-Type": "application/json" },
    });

  try {
    const body = await req.json().catch(() => ({}));
    const { lesson_session_id, credit_note_id } = body ?? {};

    // Exactly one of the two keys. Both, or neither, is a caller bug.
    const mode: "session" | "note" | null =
      typeof lesson_session_id === "string" && credit_note_id == null
        ? "session"
        : typeof credit_note_id === "string" && lesson_session_id == null
        ? "note"
        : null;
    if (!mode) return respond({ sent: 0, reason: "bad request" }, 400);

    const authHeader = req.headers.get("Authorization") ?? "";
    const anon = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } },
    );
    const { data: userRes } = await anon.auth.getUser();
    if (!userRes?.user) return respond({ sent: 0, reason: "unauthorized" }, 401);

    const svc = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    let tenantId: string;
    let candidates;

    if (mode === "session") {
      const { data: sessionTenant } = await anon.rpc("session_tenant", {
        p_session_id: lesson_session_id,
      });
      if (typeof sessionTenant !== "string") {
        return respond({ sent: 0, reason: "not found" }, 404);
      }
      tenantId = sessionTenant;

      // Verbatim the live attendance_write policy, so this grants no authority the
      // edit itself did not have: main coach, OR the platform admin, OR an admin
      // whose role holds operations:edit (20260927000400 re-pointed the policy
      // from can_admin_tenant; this path sends only for a session the caller
      // could have marked).
      const [{ data: isMain }, { data: isPlatform }, { data: hasOps }] = await Promise.all([
        anon.rpc("coach_is_main_on_session", { p_session_id: lesson_session_id }),
        anon.rpc("is_platform_admin"),
        anon.rpc("has_admin_area", { p_tenant: tenantId, p_area: "operations", p_level: "edit" }),
      ]);
      const isAdmin = isPlatform === true || hasOps === true;
      if (
        !authorizeCreditNoteEmail("session", {
          isMainOnSession: isMain === true,
          isAdminOfSessionTenant: isAdmin === true,
          isTenantAdminOfNoteTenant: false,
        })
      ) {
        return respond({ sent: 0, reason: "not allowed" }, 403);
      }

      candidates = await findUnsentBySession(svc, lesson_session_id, tenantId);
    } else {
      const found = await findUnsentById(svc, credit_note_id);
      if (!found.ok) {
        console.log(`credit-note email ${found.reason}`);
        return respond({ sent: 0, reason: "lookup failed" });
      }
      // Mid-send under someone else's fresh claim (the coach's save, or a first
      // press still in flight). Not "nothing to send" — that means emailed.
      if (found.sending) return respond({ sent: 0, reason: "sending" });
      // Already emailed, or no such note. Both are nothing-to-do — and the first is
      // what stops a second press of Resend re-sending.
      if (!found.notes.length) return respond({ sent: 0, reason: "nothing to send" });
      tenantId = found.notes[0].tenant_id;

      // ⚠ RISK 4 — is_tenant_admin, NOT can_admin_tenant. The latter is
      // `is_platform_admin() OR is_tenant_admin(...)`, and the Credit Notes page
      // selects UNFILTERED and relies on RLS, which hands a platform admin every
      // tenant's rows. Using it here would let the operator on admin.swimsync.sg send
      // mail `From: <another business>` to that business's parents.
      // PROHIBITION: do not widen this to make a platform admin's 403 go away. That
      // 403 is the feature.
      // Roles (20260927000600 era): the admin must hold billing:edit — sending a
      // credit note is a billing act. has_admin_area is false for a platform
      // admin exactly as is_tenant_admin was, so RISK 4 above still holds.
      const { data: isTenantAdmin } = await anon.rpc("has_admin_area", {
        p_tenant: tenantId,
        p_area: "billing",
        p_level: "edit",
      });
      if (
        !authorizeCreditNoteEmail("note", {
          isMainOnSession: false,
          isAdminOfSessionTenant: false,
          isTenantAdminOfNoteTenant: isTenantAdmin === true,
        })
      ) {
        return respond({ sent: 0, reason: "not allowed" }, 403);
      }
      candidates = found;
    }

    if (!candidates.ok) {
      console.log(`credit-note email ${candidates.reason}`);
      return respond({ sent: 0, reason: "discovery failed" });
    }
    const notes = candidates.notes;
    if (!notes.length) return respond({ sent: 0 });

    // ⚠ RISK 10 — a suspended business is dark; never email in its name.
    //
    // Read as a COLUMN, never via the tenant_suspended() RPC: service_role holds no
    // EXECUTE on it, so the RPC form failed OPEN on every call. That was a live bug
    // caught in review — see fetchTenantSuspended. FAILS CLOSED: null means "could
    // not tell", which must not send.
    const suspended = await fetchTenantSuspended(svc, tenantId);
    if (suspended === null) {
      return respond({ sent: 0, reason: "tenant check failed" });
    }
    if (!canEmailForTenant({ suspended })) {
      return respond({ sent: 0, reason: "tenant suspended" });
    }

    // Both checks FAIL CLOSED: unable to prove a note is unspent, or that its invoice
    // line was never emailed, means not emailing it. A missed notification costs the
    // Resend button one press; the other direction misstates a real parent's bill.
    const spentRes = await findSpentNoteIds(svc, notes.map((n) => n.id));
    if (!spentRes.ok) {
      console.log(`credit-note email ${spentRes.reason}`);
      return respond({ sent: 0, reason: "applications check failed" });
    }
    const itemsRes = await findEmailedInvoiceItemIds(
      svc,
      [...new Set(notes.map((n) => n.invoice_item_id).filter(Boolean))],
    );
    if (!itemsRes.ok) {
      console.log(`credit-note email ${itemsRes.reason}`);
      return respond({ sent: 0, reason: "sibling check failed" });
    }

    const balances = await fetchBalances(
      svc,
      tenantId,
      [...new Set(notes.map((n) => n.parent_id))],
    );

    // The admin's Resend (note mode) is a human decision, so it may claim a
    // MAY_HAVE_SENT note (CRASH_SAFE_EMAIL_CLAIM_PLAN.md §2) — under the note's
    // one key, lapsed by then (creditNoteIdempotencyKey). The coach path never does.
    const { sent, firstSkip } = await sendNotes(
      svc,
      notes,
      { spent: spentRes.spent, emailedItems: itemsRes.items },
      {
        send: resendSender(Deno.env.get("RESEND_API_KEY")),
        balances,
        manual: mode === "note",
      },
    );

    // Report WHY nothing went out, so the admin's inline error is actionable rather
    // than a bare "not sent" — the skip reasons are the likeliest blocked presses.
    return respond(sent === 0 && firstSkip ? { sent, reason: firstSkip } : { sent });
  } catch (e) {
    console.log(`credit-note-emails error: ${(e as Error).message}`);
    return respond({ sent: 0, reason: "internal" });
  }
});
