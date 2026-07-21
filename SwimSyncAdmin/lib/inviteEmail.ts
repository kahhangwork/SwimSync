// Transactional invite email — SwimSync asking a new business owner to set
// their password and take over their newly provisioned business.
//
// WHY THIS IS SWIMSYNC-BRANDED, unlike every other email in the product.
// Invoice and package emails are branded as the BUSINESS, because a parent pays
// their coach or school and an email headed "SwimSync" reads as a platform bill
// (PRD §7.10). This one is the opposite case: SwimSync itself is inviting
// someone to operate a business that does not have an identity to them yet.
// The business is named in the body, as the thing they are being given.
//
// WHY WE SEND IT OURSELVES rather than letting Supabase Auth send an invite.
// auth.admin.generateLink({type:'invite'}) mints the link WITHOUT sending, so
// the template lives here in code — unit-testable, reviewable, and with no
// dashboard paste in production that could silently drift from this file.
//
// HOW THIS DIFFERS FROM sendInvoiceEmail, deliberately:
// invoice email delivery is best-effort and its failure is swallowed, because
// BILLING must not depend on an email. Here the email IS the deliverable — an
// invite nobody receives means the business owner has no way in at all — so the
// caller must surface { sent: false } to the operator rather than logging it and
// reporting success. It still never throws; it reports.

const DEFAULT_FROM = "SwimSync <noreply@swimsync.sg>";

export type SendResult = { sent: boolean; reason?: string };

export type InviteEmailData = {
  /** The person being invited. */
  adminName: string;
  /** The business they will administer. */
  businessName: string;
  /** The one-time link from auth.admin.generateLink({ type: 'invite' }). */
  actionLink: string;
  /** Shown so they can hand it to parents once they're in. Optional. */
  joinCode?: string;
};

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function buildInviteEmailSubject(data: InviteEmailData): string {
  const biz = data.businessName?.trim();
  return biz
    ? `Set up ${biz} on SwimSync`
    : "Set up your business on SwimSync";
}

export function buildInviteEmailHtml(data: InviteEmailData): string {
  const name = escapeHtml(data.adminName?.trim() || "there");
  const biz = escapeHtml(data.businessName?.trim() || "your business");
  // The link is href-embedded; escaping it protects the attribute context.
  const link = escapeHtml(data.actionLink);
  const code = data.joinCode?.trim();

  return `<!doctype html>
<html>
  <body style="margin:0;padding:0;background:#f8fafc;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f8fafc;padding:32px 16px;">
      <tr>
        <td align="center">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#ffffff;border-radius:16px;border:1px solid #e2e8f0;overflow:hidden;">
            <tr>
              <td style="background:#0ea5e9;padding:24px;text-align:center;">
                <span style="color:#ffffff;font-size:20px;font-weight:700;letter-spacing:0.3px;">SwimSync</span>
              </td>
            </tr>
            <tr>
              <td style="padding:28px 24px;">
                <h1 style="margin:0 0 12px;font-size:20px;color:#0f172a;">You're set up on SwimSync</h1>
                <p style="margin:0 0 16px;font-size:14px;color:#475569;line-height:1.6;">
                  Hi ${name}, an account has been created for you to run
                  <strong>${biz}</strong> on SwimSync. Choose a password to get started.
                </p>
                <p style="margin:0 0 24px;font-size:14px;color:#475569;line-height:1.6;">
                  From there you can add your classes and coaches, assign children,
                  mark attendance and generate invoices.
                </p>
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
                ${
                  code
                    ? `<p style="margin:0 0 8px;font-size:13px;color:#475569;line-height:1.6;">
                  Your join code is
                  <strong style="font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:15px;color:#0f172a;">${escapeHtml(
                    code
                  )}</strong> — parents enter this in the SwimSync app to join ${biz}.
                  You can find and change it any time on your dashboard.
                </p>`
                    : ""
                }
                <p style="margin:16px 0 0;font-size:12px;color:#94a3b8;line-height:1.6;">
                  This link can only be used once. If it has expired, ask your
                  SwimSync contact to send you a new invite.
                </p>
              </td>
            </tr>
            <tr>
              <td style="background:#f8fafc;padding:16px 24px;text-align:center;border-top:1px solid #e2e8f0;">
                <p style="margin:0;font-size:12px;color:#94a3b8;">Sent by SwimSync</p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}

/**
 * Send the invite via the Resend HTTP API. NEVER throws — it reports.
 *
 * Returns { sent: false, reason: 'no_api_key' } when RESEND_API_KEY is unset, so
 * local dev and tests never send. The CALLER MUST NOT treat that as success:
 * unlike an invoice email, a missing invite leaves the business unreachable.
 */
export async function sendInviteEmail(
  opts: InviteEmailData & {
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
        to: opts.to,
        subject: buildInviteEmailSubject(opts),
        html: buildInviteEmailHtml(opts),
      }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      return {
        sent: false,
        reason: `resend_${res.status}: ${body.slice(0, 200)}`,
      };
    }
    return { sent: true };
  } catch (e) {
    return { sent: false, reason: `fetch_error: ${(e as Error).message}` };
  }
}
