// Admins page — app/api/* routes. These carry the bearer token from the current
// session; the owner-gating lives server-side.

import { supabase } from "@/lib/supabase";

export async function authedFetch(path: string, body?: unknown) {
  const { data: session } = await supabase.auth.getSession();
  const res = await fetch(path, {
    method: body === undefined ? "GET" : "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${session.session?.access_token ?? ""}`,
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const json = await res.json().catch(() => ({}));
  return { ok: res.ok, json };
}

// Phase 2 of the load: the auth-layer half (auth.users.last_sign_in_at), behind
// a serverless cold start. On failure the caller quietly keeps the "—" pills, so
// this returns null rather than throwing.
export async function listAdmins() {
  const { data: session } = await supabase.auth.getSession();
  const res = await fetch("/api/list-admins", {
    headers: {
      Authorization: `Bearer ${session.session?.access_token ?? ""}`,
    },
  }).catch(() => null);
  if (!res?.ok) return null;
  return res.json().catch(() => null);
}
