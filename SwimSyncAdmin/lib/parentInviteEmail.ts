// Transactional invite email — a swim school or coach asking a parent to set up
// the SwimSync account that already holds their child.
//
// WHY THIS IS BUSINESS-BRANDED, unlike lib/inviteEmail.ts. That one is SwimSync
// inviting a new operator to run a business they do not yet have a relationship
// with. This one is the ordinary case PRD §7.10 governs: the parent knows their
// coach, not SwimSync, and an email headed "SwimSync" gives no clue who is
// asking — worse here than on an invoice, because the recipient has never even
// heard of the platform. SwimSync appears only in the footer, as the sender.
//
// LIKE the admin invite and UNLIKE an invoice email, delivery failure is NOT
// swallowed: an invoice email that does not arrive costs a reminder, whereas an
// invite that does not arrive means the parent never gets an account and their
// child's lessons keep holding the billing month open. The caller must surface
// { sent: false } rather than reporting success.

const DEFAULT_FROM = "SwimSync <noreply@swimsync.sg>";

export type SendResult = { sent: boolean; reason?: string };

export type ParentInviteEmailData = {
  /** The business doing the inviting — whose name heads the email. */
  businessName: string;
  /** The child already on their roster. Named because it is the proof this is
   *  not spam: the parent recognises their own child. */
  studentName: string;
  /** The one-time link from auth.admin.generateLink({ type: 'invite' }). */
  actionLink: string;
  /** How many lessons are already recorded, if any. Sets the expectation that
   *  a first invoice may cover lessons already taught. */
  lessonsRecorded?: number;
};

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function buildParentInviteSubject(data: ParentInviteEmailData): string {
  const biz = data.businessName?.trim();
  return biz
    ? `${biz} has set up your SwimSync account`
    : "Your SwimSync account is ready";
}

export function buildParentInviteHtml(data: ParentInviteEmailData): string {
  const biz = escapeHtml(data.businessName?.trim() || "Your coach");
  const child = escapeHtml(data.studentName?.trim() || "your child");
  const link = escapeHtml(data.actionLink);
  const lessons = Number(data.lessonsRecorded ?? 0);

  return `<!doctype html>
<html>
  <body style="margin:0;padding:0;background:#f8fafc;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f8fafc;padding:32px 16px;">
      <tr>
        <td align="center">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#ffffff;border-radius:16px;border:1px solid #e2e8f0;overflow:hidden;">
            <tr>
              <td style="background:#0ea5e9;padding:24px;text-align:center;">
                <span style="color:#ffffff;font-size:20px;font-weight:700;letter-spacing:0.3px;">${biz}</span>
              </td>
            </tr>
            <tr>
              <td style="padding:28px 24px;">
                <h1 style="margin:0 0 12px;font-size:20px;color:#0f172a;">Your account is ready</h1>
                <p style="margin:0 0 16px;font-size:14px;color:#475569;line-height:1.6;">
                  ${biz} uses SwimSync for attendance and billing, and has already
                  added <strong>${child}</strong> for you. Choose a password to see
                  their attendance, invoices and payment details.
                </p>
                ${
                  lessons > 0
                    ? `<p style="margin:0 0 16px;font-size:14px;color:#475569;line-height:1.6;">
                  <strong>${lessons}</strong> lesson${lessons === 1 ? "" : "s"} ${
                        lessons === 1 ? "has" : "have"
                      } already been recorded for ${child}. These will appear on your
                  first invoice.
                </p>`
                    : ""
                }
                <table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 0 24px;">
                  <tr>
                    <td style="border-radius:10px;background:#0ea5e9;">
                      <a href="${link}"
                         style="display:inline-block;padding:12px 22px;font-size:14px;font-weight:600;color:#ffffff;text-decoration:none;">
                        Set your password
                      </a>
                    </td>
                  </tr>
                </table>
                <p style="margin:16px 0 0;font-size:12px;color:#94a3b8;line-height:1.6;">
                  This link can only be used once. If it has expired, ask ${biz}
                  to send you a new one.
                </p>
              </td>
            </tr>
            <tr>
              <td style="background:#f8fafc;padding:16px 24px;text-align:center;border-top:1px solid #e2e8f0;">
                <p style="margin:0;font-size:12px;color:#94a3b8;">Sent via SwimSync</p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}

/** Send via the Resend HTTP API. NEVER throws — it reports. */
export async function sendParentInviteEmail(
  opts: ParentInviteEmailData & {
    apiKey: string | undefined;
    to: string | null | undefined;
    from?: string;
  }
): Promise<SendResult> {
  if (!opts.apiKey) return { sent: false, reason: "no_api_key" };
  if (!opts.to) return { sent: false, reason: "no_recipient" };

  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${opts.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: opts.from ?? DEFAULT_FROM,
        to: [opts.to],
        subject: buildParentInviteSubject(opts),
        html: buildParentInviteHtml(opts),
      }),
    });
    if (!res.ok) {
      return { sent: false, reason: `resend_${res.status}` };
    }
    return { sent: true };
  } catch (e) {
    return { sent: false, reason: (e as Error).message };
  }
}
