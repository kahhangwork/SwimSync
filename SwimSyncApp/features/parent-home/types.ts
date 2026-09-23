// The parent Home tab's entity types (docs/refactor/BATCH_FGH_PLAN.md, App L-F) —
// moved verbatim from app/(parent)/home/index.tsx, comments included.

export type Child = {
  id: string;
  full_name: string;
  // "inactive" was dropped from the enum — activity is its own axis now
  // (students.is_active), so a departed child must not read "Unassigned".
  assignment_status: "unassigned" | "assigned";
  is_active: boolean;
  /** EVERY class the child attends, not "the" class. A child may hold several
   *  active enrolments since Wave 2 (`20260811000100`), and a keen swimmer
   *  taking two sessions a week is the ordinary case this exists for. The card
   *  renders one block each: a family's question is "when is my child
   *  swimming?", and answering it for only one of two classes is worse than
   *  not answering, because nothing on screen says a second one exists. */
  classes: ChildClass[];
  /** An upcoming, uncancelled trial: the class title and the date. */
  trial: { class_title: string; session_date: string } | null;
  /** An upcoming, uncancelled make-up: one lesson in ANOTHER class of the
   *  same kind. Rendered IN ADDITION to the class blocks — an enrolled child
   *  keeps their weekly classes, the make-up is extra. */
  makeup: { class_title: string; session_date: string } | null;
};

export type ChildClass = {
  coach_name: string | null;
  day: string | null;
  time: string | null;
  location: string | null;
};

/** A claim the coach has not decided yet, or has declined. */
export type PendingClaim = {
  id: string;
  claimed_name: string;
  status: "pending" | "declined";
  created_at: string;
};
