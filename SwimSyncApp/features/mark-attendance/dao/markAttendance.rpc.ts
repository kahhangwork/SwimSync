// The marking screen's Postgres functions + the client-holding lib/ helpers,
// bound here so no hook touches the client (COACH_ATTENDANCE_REFACTOR_PLAN.md, Stage 3).
//
// ⚠ ORCHESTRATE, NEVER REPLACE (docs/ARCHITECTURE.md §6): these are thin bindings.
// The rules each function enforces live in the DATABASE — coach_is_active_class_shadow()
// and session_shadow_coaches() are gated on the same predicates as the writes — and
// nothing here may re-implement, pre-filter or second-guess them.
import { supabase } from "@/lib/supabase";
import { fetchMarkableFloor } from "@/lib/markableFloor";
import { fetchIsMainOnSession } from "@/lib/sessionMainCoach";

// ⚠ An RPC, not a filtered table read — §7.141; see the call site in useAttendanceLoad.
export const isActiveClassShadow = (id: string) =>
  supabase.rpc("coach_is_active_class_shadow", { p_class_id: id });

// (class, date) — NOT the session id; see the call site.
export const sessionShadowCoaches = (id: string, date: string) =>
  supabase.rpc(
        "session_shadow_coaches",
        { p_class_id: id, p_session_date: date }
      );

// Resolves on every path and never rejects (lib/markableFloor.ts), so the hook may
// leave it in flight across the session lookup.
export const fetchFloor = () => fetchMarkableFloor();

export const isMainOnSession = (sid: string) => fetchIsMainOnSession(sid);
