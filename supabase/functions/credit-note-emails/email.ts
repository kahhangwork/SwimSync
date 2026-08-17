// credit-note-emails — builders, pure deciders, and the Resend call.
//
// Plan: docs/plans/CREDIT_NOTE_EMAIL_PLAN.md. Every ⚠ RISK n below is that plan's
// ranked risk, and the code under it is the mitigation, not a note about one.
//
// Shape copied from ../package-emails/email.ts: local copies of shell/escapeHtml/
// money/formatDate rather than an import, because there is no _shared directory
// and both existing email functions keep their own.
//
// ⚠ RISK 6 — THE BUILDERS TAKE SCALARS ONLY, NEVER A ROW OBJECT.
// §7.155 was written for exactly this feature: "if an invoice-resend feature is
// ever built, it MUST read invoice_items.student_name, not students.full_name."
// A credit-note email IS a resend path — the admin can send it weeks later. A
// renamed child (rename_student, 2026-08-14) or a re-titled class handed to
// another coach (§7.152) would make a live join contradict both the credit note
// and the invoice the parent is holding.
//   The structural half: CreditNoteEmailData carries only strings and numbers, so
//   a `students` row CANNOT be passed to a builder. The wrong name is not merely
//   discouraged here, it is unreachable — index.ts is the only place that could
//   fetch it, and it is pinned there by its own comment plus a test.
//
// ⚠ RISK 13 — NO UTC DATE ARITHMETIC ANYWHERE IN THIS FILE.
// PROHIBITION: no .toISOString(), no .split("T")[0], no .slice(0,10), and no Date
// object built from credit_notes.issued_at (a timestamptz). That is the §7.7
// pattern — the UTC date, a day behind before 08:00 SGT — and it already ships as
// a display bug on the admin page (credit-notes/page.tsx:58). An email is worse
// than a screen. The only date rendered is sessionDate, which arrives as a real
// `date` ("YYYY-MM-DD") and goes through formatDate's string parser, no Date
// object involved. There is deliberately no issue date in the email at all: the
// parent cares which LESSON was credited, so the unsafe field is never read.

export type CreditNoteEmailData = {
  parentName: string;
  businessName: string;
  logoUrl: string | null;
  referenceNumber: string;
  /** This note's own amount. */
  amount: number;
  /** The parent's total credit with THIS business (a per-(parent,tenant) aggregate). */
  creditBalance: number;
  /** Snapshot from credit_notes.student_name — never students.full_name (⚠ RISK 6). */
  studentName: string;
  /** Snapshot from invoice_items.class_title — never classes.title (⚠ RISK 6). */
  classTitle: string;
  /** invoice_items.session_date, a real `date` (⚠ RISK 13). */
  sessionDate: string;
  /** The coach's edit_reason, when they gave one. */
  reason: string | null;
};

export type SendOutcome =
  /** No API key configured. Pre-send: nothing left our side. */
  | "no_api_key"
  /** No recipient address. Pre-send: nothing left our side. */
  | "no_recipient"
  /** Resend answered 4xx — it rejected the request. Pre-send in effect. */
  | "rejected"
  /** Resend answered 5xx. May or may not have been accepted. */
  | "server_error"
  /** fetch threw (timeout, DNS, socket). May ALREADY have been delivered. */
  | "threw"
  /** Resend answered 2xx. */
  | "ok";

export type SendResult = { sent: boolean; outcome: SendOutcome; reason?: string };

// ── Pure deciders ───────────────────────────────────────────────────────────

export type EmailMode = "session" | "note";

/**
 * ⚠ RISK 4 — the NOTE path requires a TENANT admin, not `can_admin_tenant`.
 *
 * `can_admin_tenant(p_tenant_id)` is literally
 * `SELECT is_platform_admin() OR is_tenant_admin(p_tenant_id)` (read from
 * pg_get_functiondef). The admin Credit Notes page issues an UNFILTERED select and
 * relies on RLS, which hands a platform admin every tenant's rows — so using
 * can_admin_tenant here would let the operator on admin.swimsync.sg send mail
 * `From: <some other business>` to that business's parents.
 *
 * The field names below are the structural half: the caller object has no
 * `canAdminTenant` field at all, so the wrong RPC's result has nowhere to go.
 *
 * PROHIBITION: do not add one, and do not "fix" a platform admin's 403 by
 * widening this. A platform admin has no business sending mail in a tenant's name.
 */
export function authorizeCreditNoteEmail(
  mode: EmailMode,
  caller: {
    /** coach_is_main_on_session(lesson_session_id) — session path only. */
    isMainOnSession: boolean;
    /** can_admin_tenant(session_tenant(...)) — session path only. Platform admin
     *  is acceptable HERE: it mirrors the attendance_write policy verbatim, and
     *  this path sends only for a session the caller could have marked. */
    isAdminOfSessionTenant: boolean;
    /** is_tenant_admin(note.tenant_id) — note path only. NOT can_admin_tenant. */
    isTenantAdminOfNoteTenant: boolean;
  },
): boolean {
  switch (mode) {
    case "session":
      // Verbatim the live attendance_write policy:
      //   coach_is_main_on_session(lesson_session_id)
      //     OR can_admin_tenant(session_tenant(lesson_session_id))
      // so this function grants no authority the edit itself did not have.
      return caller.isMainOnSession || caller.isAdminOfSessionTenant;
    case "note":
      return caller.isTenantAdminOfNoteTenant;
  }
}

/**
 * ⚠ RISK 2 (ranked #2) — refuse any note that is not VIRGIN.
 *
 * The billing engine is a second writer of credit_notes: core.ts:1429 flips
 * status='applied', core.ts:1447 sets applied_to_invoice_id/applied_at, and
 * core.ts:1461 decrements the parent's credit_balance. Emailing an applied note
 * renders "your credit balance is now S$0.00" beside the line promising it will be
 * applied to the next invoice — for a credit already consumed.
 *
 * PARTIAL CONSUMPTION IS THE WORSE CASE and is why `status` alone is not enough:
 * credit_applications lets a $30 note be half-spent while status stays
 * 'available' (core.ts:1437-1445), so the note looks resendable and the quoted
 * balance bears no relation to it. A real parent is told they hold credit they
 * have already spent, and may under-pay.
 *
 * Applies to BOTH paths. A coach re-saving an old lesson must not resurrect an
 * applied note either.
 */
export function isSendableNote(note: {
  status: string;
  appliedToInvoiceId: string | null;
  /** True if ANY credit_applications row exists for this note. */
  hasApplications: boolean;
}): boolean {
  if (note.appliedToInvoiceId !== null) return false;
  if (note.status !== "available") return false;
  if (note.hasApplications) return false;
  return true;
}

/**
 * ⚠ RISK 10 — a suspended business is DARK, so never email in its name.
 *
 * credit_notes_select denies the parent visibility while
 * `tenant_suspended(tenant_id)`, so an email would describe a credit they cannot
 * find in the app.
 *
 * The single input is the existing `tenant_suspended()` helper's boolean — the
 * one source of truth. The plan review proposed also reading `tenants.suspend`;
 * that is NOT done and must not be added: verified from the live catalogue,
 * `tenants.suspend` is vestigial (boolean, default false) and `suspend_tenant()`
 * writes only `suspended_at`. Nothing in the repo sets it, and encoding a dead
 * column here would give it false authority. Filed for deletion in BACKLOG.md.
 *
 * `auto_disabled` is deliberately NOT a gate: it governs whether a billing RUN
 * may proceed and says nothing about whether a business is dark. §8.63's
 * shouldRetryTenantEmails takes a generate-invoices RESULT STRING and so has
 * nothing to lend this path — an earlier draft of the plan was wrong to say it did.
 *
 * No default-allow branch: the parameter is a required boolean.
 */
export function canEmailForTenant(t: { suspended: boolean }): boolean {
  return !t.suspended;
}

/**
 * ⚠ RISK 7 — reset the claim ONLY on outcomes that provably never left our side.
 *
 * The claim (`email_sent_at = now()`) is released on failure so the note can be
 * resent. But `fetch` throwing does NOT mean Resend refused: a timeout can arrive
 * after Resend accepted AND delivered. Releasing the claim then makes the pill
 * reappear, the admin presses Resend, and a real parent gets the same email twice.
 * The atomic claim stops CONCURRENT duplicates; it does nothing about this one.
 *
 * So a thrown fetch and a 5xx are treated as SENT-UNKNOWN — claim stays stamped,
 * failure logged. Only the three provably-pre-send outcomes release it.
 *
 * The decision is made over a typed outcome, never by parsing an error string —
 * the precedent's sendPackageEmail returns `reason: e.message`, and a substring
 * test against that is exactly the fragile thing this avoids.
 */
export function shouldResetClaim(outcome: SendOutcome): boolean {
  switch (outcome) {
    case "no_api_key":
    case "no_recipient":
    case "rejected":
      return true;
    case "server_error":
    case "threw":
    case "ok":
      return false;
  }
}

// ── Formatting ──────────────────────────────────────────────────────────────

const DEFAULT_APP_URL = "https://swimsync.sg";

export function money(n: number): string {
  return `S$${Number(n).toFixed(2)}`;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// "2027-07-10" → "10 Jul 2027", no Date object → no timezone drift (⚠ RISK 13).
const MONTHS_SHORT = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];
export function formatDate(dateStr: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateStr);
  if (!m) return dateStr;
  const month = MONTHS_SHORT[Number(m[2]) - 1];
  if (!month) return dateStr;
  return `${Number(m[3])} ${month} ${m[1]}`;
}

function shell(businessName: string, logoUrl: string | null | undefined, body: string): string {
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f6f8;padding:32px 0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
  <tr>
    <td align="center">
      <table role="presentation" width="480" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 1px 4px rgba(0,0,0,0.06);">
        <tr>
          <td style="background:#0ea5e9;padding:24px 32px;">
            ${
              logoUrl
                ? `<img src="${escapeHtml(logoUrl)}" alt="${escapeHtml(businessName)}" height="28" style="height:28px;vertical-align:middle;border:0;" />`
                : `<span style="color:#ffffff;font-size:20px;font-weight:700;letter-spacing:0.3px;">${escapeHtml(businessName)}</span>`
            }
          </td>
        </tr>
        <tr>
          <td style="padding:32px;">${body}</td>
        </tr>
        <tr>
          <td style="padding:16px 32px;border-top:1px solid #f1f5f9;">
            <p style="margin:0;font-size:12px;color:#94a3b8;">Sent via SwimSync · <a href="${DEFAULT_APP_URL}" style="color:#94a3b8;">swimsync.sg</a></p>
          </td>
        </tr>
      </table>
    </td>
  </tr>
</table>`;
}

export function buildCreditNoteSubject(d: CreditNoteEmailData): string {
  return `${money(d.amount)} credited to your ${d.businessName} account — ${d.referenceNumber}`;
}

/**
 * ⚠ RISK 11 — TWO LABELLED NUMBERS, ALWAYS BOTH, EVEN WHEN THEY ARE EQUAL.
 *
 * creditBalance is a per-(parent, tenant) AGGREGATE: the trigger does
 * `credit_balance = credit_balance + EXCLUDED.credit_balance`. So a rained-off
 * lesson that credits two siblings $30 each sends two emails, and a single
 * "your balance is now S$60.00" in both reads as $120 to the parent.
 *
 * Second reason the balance must NAME THE BUSINESS: the parent's own app pools
 * credit across tenants — SwimSyncApp/app/(parent)/home/index.tsx:154 sums
 * credit_balance over EVERY tenant row — while this figure is per-business
 * (correct per PRD §5.6). Identical for every production parent today; it diverges
 * the day one belongs to two businesses.
 *
 * Both fields are required and non-optional on CreditNoteEmailData, so the
 * template cannot silently omit either.
 */
export function buildCreditNoteHtml(d: CreditNoteEmailData): string {
  const reasonLine = d.reason
    ? `<p style="margin:0 0 16px;font-size:14px;line-height:1.6;color:#64748b;">
         Reason given: ${escapeHtml(d.reason)}
       </p>`
    : "";

  return shell(
    d.businessName,
    d.logoUrl,
    `<h1 style="margin:0 0 12px;font-size:20px;color:#0f172a;">A lesson has been credited back</h1>
     <p style="margin:0 0 16px;font-size:15px;line-height:1.6;color:#475569;">
       Hi ${escapeHtml(d.parentName)}, ${escapeHtml(d.businessName)} has corrected a
       lesson that was already invoiced, so its cost has been credited back to you.
     </p>
     <table role="presentation" width="100%" cellpadding="0" cellspacing="0"
            style="margin:0 0 20px;font-size:14px;color:#0f172a;border-collapse:collapse;">
       <tr>
         <td style="padding:8px 0;color:#64748b;">Lesson</td>
         <td style="padding:8px 0;text-align:right;">
           ${escapeHtml(d.studentName)} · ${escapeHtml(d.classTitle)}
         </td>
       </tr>
       <tr>
         <td style="padding:8px 0;color:#64748b;">Date</td>
         <td style="padding:8px 0;text-align:right;">${escapeHtml(formatDate(d.sessionDate))}</td>
       </tr>
       <tr>
         <td style="padding:8px 0;color:#64748b;">Credit note</td>
         <td style="padding:8px 0;text-align:right;">${escapeHtml(d.referenceNumber)}</td>
       </tr>
       <tr>
         <td style="padding:8px 0;border-top:1px solid #f1f5f9;color:#64748b;">This credit note</td>
         <td style="padding:8px 0;border-top:1px solid #f1f5f9;text-align:right;font-weight:700;">
           ${money(d.amount)}
         </td>
       </tr>
       <tr>
         <td style="padding:8px 0;color:#64748b;">
           Total credit with ${escapeHtml(d.businessName)}
         </td>
         <td style="padding:8px 0;text-align:right;font-weight:700;">
           ${money(d.creditBalance)}
         </td>
       </tr>
     </table>
     ${reasonLine}
     <p style="margin:0 0 8px;font-size:14px;line-height:1.6;color:#475569;">
       Your total includes this credit and any earlier ones still unused. It is
       applied automatically to your next invoice from
       ${escapeHtml(d.businessName)} — there is nothing you need to do, and no
       payment is needed for the credited lesson.
     </p>
     <p style="margin:0;font-size:13px;line-height:1.6;color:#94a3b8;">
       If this doesn't look right, reply to your coach — they can correct the
       attendance again.
     </p>`,
  );
}

/**
 * Send via the Resend HTTP API. Logged no-op without a key.
 *
 * Returns a TYPED outcome so shouldResetClaim (⚠ RISK 7) can distinguish
 * "never left our side" from "may already be in the parent's inbox" without
 * parsing an error message.
 */
export async function sendCreditNoteEmail(opts: {
  apiKey: string | undefined;
  to: string | undefined;
  subject: string;
  html: string;
  fromName: string;
}): Promise<SendResult> {
  if (!opts.apiKey) {
    return { sent: false, outcome: "no_api_key", reason: "RESEND_API_KEY not set" };
  }
  if (!opts.to) {
    return { sent: false, outcome: "no_recipient", reason: "no recipient" };
  }

  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${opts.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: `${opts.fromName} <noreply@swimsync.sg>`,
        to: [opts.to],
        subject: opts.subject,
        html: opts.html,
      }),
    });
    if (!res.ok) {
      // 4xx = Resend refused, nothing sent, safe to release the claim.
      // 5xx = unknown; it may have been accepted. Keep the claim (⚠ RISK 7).
      return {
        sent: false,
        outcome: res.status >= 500 ? "server_error" : "rejected",
        reason: `resend ${res.status}: ${await res.text()}`,
      };
    }
    return { sent: true, outcome: "ok" };
  } catch (e) {
    // The dangerous case: a timeout AFTER Resend accepted and delivered.
    return { sent: false, outcome: "threw", reason: (e as Error).message };
  }
}
