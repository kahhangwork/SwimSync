// The public-invoice Edge Function — the page's only transport
// (docs/refactor/BATCH_FGH_PLAN.md, App L-G). Both calls are byte-identical to the
// fetch( they replaced in app/invoice/[token].tsx and return the raw Response
// promise; the caller keeps its try/catch and its `res.ok` / `res.json()` reads.
//
// ⚠ plan R2 — named prohibitions:
//   • NO supabase.functions.invoke and NO apikey / Authorization header. The
//     function allows only `Access-Control-Allow-Headers: content-type`
//     (supabase/functions/public-invoice/index.ts), so any added header fails the
//     CORS preflight — and a failed fetch renders "Invoice not found", which is
//     exactly what a bad link shows, so no driver could tell.
//   • FUNCTIONS_URL keeps the LITERAL `process.env.EXPO_PUBLIC_SUPABASE_URL`: Expo
//     inlines only that exact member-access form.
//
// dao/ is transport only (fence check 2).

const FUNCTIONS_URL = `${process.env.EXPO_PUBLIC_SUPABASE_URL}/functions/v1/public-invoice`;

export const fetchPublicInvoice = (token: string | undefined) =>
  fetch(
    `${FUNCTIONS_URL}?token=${encodeURIComponent(token ?? "")}`,
  );

export const postPublicInvoiceClaim = (token: string | undefined) =>
  fetch(FUNCTIONS_URL, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ token, action: "claim" }),
  });
