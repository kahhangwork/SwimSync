// Tell the backend to email any credit notes a just-saved attendance edit issued.
//
// Plan: docs/plans/CREDIT_NOTE_EMAIL_PLAN.md (⚠ RISK 9).
//
// ⚠ RISK 9 — WHY THIS IS AWAITED AND NOT FIRE-AND-FORGET.
// The first draft of the plan fired the request and moved on, on the reasoning that
// an email must never delay a save. That was wrong about WHERE the request goes to
// die. The attendance screen's save ends:
//
//     setSaving(false);
//     showToast("Attendance saved.", "success");
//     leaveScreen();              // ← router.replace, THIS unmounts the screen
//
// so an unawaited fetch is issued a few milliseconds before navigation, and a coach
// poolside locks the phone within a second. Backgrounding suspends the in-flight
// request on native; closing the tab aborts it on RN-web. That makes the drop the
// NORMAL path, not the exceptional one — and a normally-dropped send would leave
// "Not emailed" as the default state on the admin page, destroying the signal that
// the Resend button depends on, which in turn invites mass-resending.
//
// The precedent that was cited for fire-and-forget actually holds its screen:
// SwimSyncApp/app/(parent)/billing/index.tsx awaits loadData() before router.push.
//
// So: await, but bounded. The attendance rows are ALREADY committed before this is
// called, so waiting risks nothing except the coach looking at the save spinner a
// little longer — and losing the race costs at most `timeoutMs`, after which the
// save completes exactly as it does today.
//
// Silent by contract (the user's decision): a failed email is not something the
// coach can act on, and it IS actionable by the admin, on the Credit Notes page.
// Same reasoning that kept invoice counts off the coach app (§8.27).
// PROHIBITION: do not surface this failure to the coach, and do not reach for
// Alert.alert — it is a no-op on RN-web anyway.

/**
 * Anything with a `functions.invoke`. Injected so the test needs no real client.
 *
 * `body` is Record<string, unknown> rather than unknown on purpose: the parameter
 * position is contravariant, so a real SupabaseClient is only assignable here if
 * this body type is assignable to Supabase's own (which accepts Record<string,
 * any>). Declaring `unknown` compiles in isolation and then rejects the real client
 * at the call site.
 */
type InvokerClient = {
  functions: {
    invoke: (
      name: string,
      opts: { body: Record<string, unknown> },
    ) => Promise<unknown>;
  };
};

export const CREDIT_NOTE_EMAIL_TIMEOUT_MS = 3000;

/**
 * The statuses `handle_attendance_update` treats as billable. Leaving one of these
 * for anything else is the ONLY edit that can issue a credit note — the trigger's
 * condition is:
 *   OLD.status IN ('present','trial_paid') AND NEW.status NOT IN ('present','trial_paid')
 */
const BILLABLE = ["present", "trial_paid"];

/**
 * Could this save have issued a credit note?
 *
 * WHY THIS EXISTS: without it the coach waits on a full edge-function round trip after
 * EVERY attendance save — cold start plus five queries — to be told there was nothing
 * to do. A credit note needs an already-invoiced lesson to leave a billable status,
 * which happens a few times a month; marking a normal lesson happens constantly. The
 * 3s bound was reasoned about for the rare firing, not for the universal one.
 *
 * Deliberately IGNORANT of whether the lesson was invoiced: the client cannot know
 * that, and the server is authoritative either way. This only skips saves where a note
 * is IMPOSSIBLE, never where it is merely unlikely — so a false negative cannot arise,
 * while a false positive costs only the round trip that used to be paid every time.
 */
export function mayHaveIssuedCreditNote(
  before: Record<string, string | null>,
  after: Record<string, string | null>,
): boolean {
  for (const [studentId, next] of Object.entries(after)) {
    const prev = before[studentId] ?? null;
    if (prev !== null && BILLABLE.includes(prev) && !BILLABLE.includes(next ?? "")) {
      return true;
    }
  }
  return false;
}

/**
 * Ask the credit-note-emails function to send for this lesson. Resolves when the
 * request settles OR the timeout elapses, whichever comes first — never rejects.
 *
 * Call it AFTER the attendance upsert has succeeded and BEFORE navigating away.
 * A failed save issues no credit note, so calling it then would be noise.
 */
export async function notifyCreditNoteEmails(
  client: InvokerClient,
  lessonSessionId: string,
  timeoutMs: number = CREDIT_NOTE_EMAIL_TIMEOUT_MS,
): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      // The catch is INSIDE the race: a rejection must resolve the race rather
      // than reject it, or a network error would surface as an unhandled throw in
      // the save path — the one thing this must never disturb.
      Promise.resolve()
        .then(() =>
          client.functions.invoke("credit-note-emails", {
            body: { lesson_session_id: lessonSessionId },
          }),
        )
        .catch(() => undefined),
      new Promise<void>((resolve) => {
        timer = setTimeout(resolve, timeoutMs);
      }),
    ]);
  } catch {
    // Belt and braces: nothing above should throw, and if it somehow does, the
    // save must still finish.
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}
