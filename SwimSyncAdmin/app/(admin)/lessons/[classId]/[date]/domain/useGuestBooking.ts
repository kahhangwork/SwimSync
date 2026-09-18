"use client";

// Book a make-up or trial INTO this lesson, and cancel a guest's booking. Stage 5
// of docs/refactor/LESSON_DETAIL_REFACTOR_PLAN.md — state, derived values and
// handlers verbatim.
//
// cancelBooking reports into the attendance bar's `saveMsg` (the SAVE slice's
// state), which arrives as a creation dep (playbook §5). The two open buttons
// clear bookError in their own onClick — that stays in the markup, not here.

import { useMemo, useState, type Dispatch, type SetStateAction } from "react";
import { filterEligibleKids } from "@/lib/makeupSearch";
import { bookMakeup, bookTrial, cancelMakeupBooking, cancelTrialBooking } from "../dao/lessonDetail.rpc";
import type { ClassInfo, EligibleKid, RosterRow, SaveMsg } from "../types";

export function useGuestBooking(input: {
  classId: string;
  date: string;
  cls: ClassInfo | null;
  kids: EligibleKid[];
  reload: () => void;
  setSaveMsg: Dispatch<SetStateAction<SaveMsg>>;
}) {
  const { classId, date, cls, kids, reload, setSaveMsg } = input;
  const [bookKind, setBookKind] = useState<"makeup" | "trial" | null>(null);
  const [bookQuery, setBookQuery] = useState("");
  const [bookKid, setBookKid] = useState("");
  const [bookHome, setBookHome] = useState("");
  const [bookBusy, setBookBusy] = useState(false);
  const [bookError, setBookError] = useState<string | null>(null);

  // ── Guests ──────────────────────────────────────────────────────────────
  const bookKidRow = kids.find((k) => k.id === bookKid);
  const homeClass =
    bookKidRow?.home_classes.find((c) => c.id === bookHome) ??
    (bookKidRow?.home_classes.length === 1 ? bookKidRow.home_classes[0] : undefined);
  // Eligible for a make-up INTO this lesson: active, enrolled somewhere in the
  // same category, and NOT in this class. The RPC re-checks all of it (§7.32).
  const makeupCandidates = useMemo(() => {
    if (!cls) return [];
    return filterEligibleKids(
      kids.filter((k) => k.home_classes.some((c) => c.category_id === cls.category_id) && !k.home_classes.some((c) => c.id === cls.id)),
      bookQuery
    );
  }, [kids, cls, bookQuery]);

  async function doBook() {
    if (!cls) return;
    setBookBusy(true);
    setBookError(null);
    const { error } =
      bookKind === "makeup"
        ? await bookMakeup(classId, date, bookKid, homeClass?.id ?? null)
        : await bookTrial(classId, date, bookKid);
    setBookBusy(false);
    if (error) {
      setBookError(error.message);
      return;
    }
    setBookKind(null);
    setBookKid("");
    setBookHome("");
    setBookQuery("");
    reload();
  }
  function requestBook() {
    if (!bookKid) {
      setBookError("Choose a child.");
      return;
    }
    if (bookKind === "makeup" && bookKidRow && bookKidRow.home_classes.length > 1 && !homeClass) {
      setBookError("Choose which class this make-up replaces.");
      return;
    }
    void doBook();
  }
  async function cancelBooking(row: RosterRow) {
    if (!row.bookingId) return;
    const fn = row.kind === "trial" ? cancelTrialBooking : cancelMakeupBooking;
    const { error } = await fn(row.bookingId);
    if (error) {
      setSaveMsg({ kind: "error", text: `Could not cancel the booking: ${error.message}` });
      return;
    }
    reload();
  }

  return {
    bookKind,
    setBookKind,
    bookQuery,
    setBookQuery,
    bookKid,
    setBookKid,
    bookHome,
    setBookHome,
    bookBusy,
    bookError,
    setBookError,
    bookKidRow,
    makeupCandidates,
    requestBook,
    cancelBooking,
  };
}
