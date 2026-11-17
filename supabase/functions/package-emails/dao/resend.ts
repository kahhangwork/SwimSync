// The one network call to Resend for package emails (EDGE_FUNCTIONS_REFACTOR_PLAN.md
// B11). The caller builds init byte-for-byte; `fetch` is read at call time so test
// interceptors keep seeing every send.

export function postResendEmail(init: RequestInit): Promise<Response> {
  return fetch("https://api.resend.com/emails", init);
}
