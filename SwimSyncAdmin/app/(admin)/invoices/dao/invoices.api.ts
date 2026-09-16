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
