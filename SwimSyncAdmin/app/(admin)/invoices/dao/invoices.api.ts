// App-route calls for the Invoices page. Returns the raw Response so the caller
// keeps its exact `res.ok` / `res.json()` branching unchanged. Tier rule: dao/
// is transport only.

/** POST the billing engine. `accessToken` is the caller's session token — the
 *  route authenticates the admin and scopes generation to their tenant. */
export const generateInvoices = (accessToken: string, billingMonth: string) =>
  fetch("/api/generate-invoices", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify({ billing_month: billingMonth }),
  });

/** POST a single invoice email resend. The route checks the caller administers
 *  the invoice's business, then asks the engine to claim + send + settle it. */
export const resendInvoiceEmail = (accessToken: string, invoiceId: string) =>
  fetch("/api/resend-invoice-email", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify({ invoice_id: invoiceId }),
  });
