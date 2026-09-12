// The Students feature's server-route calls. Stage 3 of
// docs/refactor/STUDENTS_PAGE_REFACTOR_PLAN.md.
//
// This is the CLIENT end of a wire whose server end is app/api/invite-parent/
// route.ts. The route stays where it is: Next derives the URL from the file
// path, so moving it is a behaviour change, not a refactor. It is a server
// route because it creates an auth user, which needs the service role.
//
// THE RULE for future work: needs service-role / must bypass RLS → a route in
// app/api/, called from a `*.api.ts`. Everything else → students.repo.ts or
// students.rpc.ts, direct from the client under RLS.
//
// FAILURE MODE of this file (plan §3): an HTTP status, the network, or the
// route's own `{ error }` shape. Network and JSON-parse failures THROW, as the
// inline `fetch` did; the caller's try/catch owns them.

import { supabase } from "@/lib/supabase";

/** Invites `email` to claim `studentId`. Returns the route's JSON with the
 *  response's `ok`, so the caller reads `emailed` / `alreadyRegistered` /
 *  `invite_link` exactly as before. */
export async function inviteParent(studentId: string, email: string) {
  const {
    data: { session },
  } = await supabase.auth.getSession();

  const res = await fetch("/api/invite-parent", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${session?.access_token ?? ""}`,
    },
    body: JSON.stringify({ student_id: studentId, email }),
  });
  const json = await res.json();
  return { ok: res.ok, json };
}
