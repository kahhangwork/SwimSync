// The Platform page's `app/api/*` route calls. Stage 2/3 of
// docs/refactor/PLATFORM_REFACTOR_PLAN.md.
//
// dao/ is transport only: no React, no ui/, no @/components (fence check 2).

import { supabase } from "@/lib/supabase";

/** POST helper that carries the caller's token — the API routes verify it,
 *  and provision_tenant()'s gate is evaluated against THIS user, not the
 *  service role.
 *
 *  ⚠ The token is read HERE, not passed in: a dao that takes the access token as
 *  an argument pushes getSession() back into domain/, and fence check 3 goes red.
 *
 *  ⚠ There is deliberately NO try around the fetch. `res.json().catch(() => ({}))`
 *  is the whole of the error handling and it is verbatim from the page; the
 *  Students-pilot pitfall about a try boundary moving with a call does not apply
 *  here, because there was never a try to move. `json` is `any` on purpose —
 *  every caller reads a differently-shaped body off it. */
export async function postAs(
  path: string,
  body: unknown
): Promise<{ res: Response; json: any }> {
  const { data: sess } = await supabase.auth.getSession();
  const res = await fetch(path, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${sess.session?.access_token ?? ""}`,
    },
    body: JSON.stringify(body),
  });
  return { res, json: await res.json().catch(() => ({})) };
}
