// Coaches page — app/api/* routes, each carrying the session bearer token.
// The owner/authority gating lives server-side.

import { supabase } from "@/lib/supabase";

async function post(path: string, body: unknown) {
  const { data: session } = await supabase.auth.getSession();
  const res = await fetch(path, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${session.session?.access_token ?? ""}`,
    },
    body: JSON.stringify(body),
  });
  const json = await res.json();
  return { ok: res.ok, json };
}

export function createCoach(body: {
  name: string;
  email: string;
  phone: string;
  password: string;
}) {
  return post("/api/create-coach", body);
}

export function disableCoach(coachId: string, replacementCoachId: string | null) {
  return post("/api/disable-coach", { coachId, replacementCoachId });
}

export function reactivateCoach(coachId: string) {
  return post("/api/reactivate-coach", { coachId });
}
