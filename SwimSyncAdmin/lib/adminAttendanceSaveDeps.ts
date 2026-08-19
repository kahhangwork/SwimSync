// Binds adminAttendanceSave.ts to the real Supabase client. Separate file so
// the pure orchestration (and its tests) import no client.

import { notifyCreditNoteEmails } from "./creditNoteEmail";
import { supabase } from "./supabase";
import type { SaveDeps } from "./adminAttendanceSave";

/** The real client, bound. */
export function supabaseSaveDeps(): SaveDeps {
  return {
    async findSession(classId, date) {
      const { data } = await supabase
        .from("lesson_sessions")
        .select("id")
        .eq("class_id", classId)
        .eq("session_date", date)
        .maybeSingle();
      return data ? { id: data.id as string } : null;
    },
    async insertSession(classId, date) {
      const { data, error } = await supabase
        .from("lesson_sessions")
        .insert({ class_id: classId, session_date: date, status: "scheduled" })
        .select("id")
        .single();
      if (error || !data) {
        return { error: { code: (error as any)?.code, message: error?.message ?? "Could not create the lesson record." } };
      }
      return { id: data.id as string };
    },
    async upsertAttendance(rows) {
      const { error } = await supabase
        .from("attendance")
        .upsert(rows, { onConflict: "lesson_session_id,student_id" });
      return { error: error ? { code: (error as any).code, message: error.message } : null };
    },
    async insertAudit(row) {
      const { error } = await supabase.from("audit_log").insert(row);
      return { error: error ? { code: (error as any).code, message: error.message } : null };
    },
    async notifyCreditNote(sessionId) {
      await notifyCreditNoteEmails(supabase, sessionId);
    },
  };
}
