// Transactional invite email — the OWNER of a business asking someone to help
// administer it (a co-admin). Sibling of lib/inviteEmail.ts, which invites the
// business's OWNER; the two differ in exactly the ways ownership differs:
//
//   - the copy says "help manage", not "run" — this person is staff, not the
//     proprietor being handed a new business;
//   - there is NO join-code paragraph. The owner email says "you can find and
//     change it any time", which is custody language; a co-admin can see the
//     code on the dashboard once they're in, and mailing credentials people
//     don't own around is how codes leak.
//
// SwimSync-branded for the same reason as the owner invite: SwimSync itself is
// the sender of record for account onboarding, and the business is named in
// the body. Same non-throwing SendResult contract, same generateLink-then-
// send-ourselves mechanism (the template lives in code, unit-tested, no
// dashboard paste to drift).

const DEFAULT_FROM = "SwimSync <noreply@swimsync.sg>";

export type SendResult = { sent: boolean; reason?: string };

export type CoAdminInviteEmailData = {
  /** The person being invited. */
  adminName: string;
  /** The business they will help administer. */
  businessName: string;
  /** The one-time link from auth.admin.generateLink({ type: 'invite' }). */
  actionLink: string;
};

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function buildCoAdminInviteEmailSubject(
  data: CoAdminInviteEmailData
): string {
  const biz = data.businessName?.trim();
  return biz
    ? `Help manage ${biz} on SwimSync`
    : "Help manage a business on SwimSync";
}

export function buildCoAdminInviteEmailHtml(
  data: CoAdminInviteEmailData
): string {
  const name = escapeHtml(data.adminName?.trim() || "there");
  const biz = escapeHtml(data.businessName?.trim() || "the business");
  // The link is href-embedded; escaping it protects the attribute context.
  const link = escapeHtml(data.actionLink);

  return `<!doctype html>
<html>
  <body style="margin:0;padding:0;background:#fafafa;font-family:Geist,-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#fafafa;padding:32px 16px;">
      <tr>
        <td align="center">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#ffffff;border-radius:8px;border:1px solid #e5e5e5;">
            <tr>
              <td style="padding:24px;text-align:center;border-bottom:1px solid #f0f0f0;">
                <span style="color:#0a0a0a;font-size:20px;font-weight:600;letter-spacing:-0.03em;">SwimSync</span>
              </td>
            </tr>
            <tr>
              <td style="padding:28px 24px;">
                <h1 style="margin:0 0 12px;font-size:24px;font-weight:600;line-height:1.2;letter-spacing:-0.02em;color:#0a0a0a;">You've been added as an admin</h1>
                <p style="margin:0 0 16px;font-size:14px;color:#525252;line-height:1.5;">
                  Hi ${name}, an account has been created for you to help manage
                  <strong>${biz}</strong> on SwimSync. Choose a password to get started.
                </p>
                <p style="margin:0 0 24px;font-size:14px;color:#525252;line-height:1.5;">
                  From there you can assign children, mark attendance, manage
                  classes and handle invoices alongside the business owner.
                </p>
                <table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 0 24px;">
                  <tr>
                    <td style="border-radius:6px;background:#2563eb;">
                      <a href="${link}"
                         style="display:inline-block;padding:12px 16px;font-size:14px;font-weight:600;line-height:20px;color:#ffffff;text-decoration:none;border-radius:6px;">
                        Set your password
                      </a>
                    </td>
                  </tr>
                </table>
                <p style="margin:16px 0 0;font-size:12px;color:#6b6b6b;line-height:1.5;">
                  This link can only be used once. If it has expired, ask the
                  business owner to send you a new invite.
                </p>
              </td>
            </tr>
            <tr>
              <td style="padding:16px 24px;text-align:center;border-top:1px solid #f0f0f0;">
                <p style="margin:0;font-size:12px;color:#6b6b6b;">Sent by SwimSync</p>
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
 * Send the co-admin invite via the Resend HTTP API. NEVER throws — it reports.
 * { sent: false, reason: 'no_api_key' } when RESEND_API_KEY is unset (local
 * dev, tests, CI). The caller surfaces failure as a warning with the raw link,
 * never as success — an invite nobody receives is an admin with no way in.
 */
export async function sendCoAdminInviteEmail(
  opts: CoAdminInviteEmailData & {
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
        subject: buildCoAdminInviteEmailSubject(opts),
        html: buildCoAdminInviteEmailHtml(opts),
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
