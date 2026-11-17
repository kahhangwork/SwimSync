// The one network call to Resend (EDGE_FUNCTIONS_REFACTOR_PLAN.md B3). Every invoice
// email and the blocked-generation notice POST through here; the request — headers,
// Idempotency-Key, body — is built by the caller, byte-for-byte as before.
//
// `fetch` is read at CALL time (globalThis), so the tests' and the bench's fetch
// interceptors keep seeing every send.

export function postResendEmail(init: RequestInit): Promise<Response> {
  return fetch("https://api.resend.com/emails", init);
}
