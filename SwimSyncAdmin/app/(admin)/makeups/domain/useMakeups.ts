import { useEffect, useMemo, useState } from "react";
import { useTableSort } from "@/components/Table";
import { todayInSg } from "@/lib/lessonDates";
import { filterEligibleKids } from "@/lib/makeupSearch";
import * as repo from "../dao/makeups.repo";
import * as rpc from "../dao/makeups.rpc";
import {
  datesForClass,
  expiryWarningFor,
  homeClassOf,
  hostChoicesFor,
  toBookings,
  toEligible,
  toExtraMap,
  toLivePackages,
  toParentsOf,
} from "./makeupRows";
import type { Booking, ClassRow, EligibleKid, LivePackage } from "../types";

// All Make-ups state, loads and writes (Admin L-D, BATCH_D_PLAN.md).
//
// ⚠ EVERY hook the page had lives here, including useTableSort — the page calls
// this once and only THEN returns early while loading (RISK 3: hook order). The
// sort also must NOT move into ui/: loadAll() flips `loading`, which unmounts
// everything below the early return, so a ui/-held sort would reset after every
// Book or Cancel. Held here, it survives reloads exactly as it did on the page.
export function useMakeups() {
  const [upcoming, setUpcoming] = useState<Booking[]>([]);
  const [past, setPast] = useState<Booking[]>([]);
  const [classes, setClasses] = useState<ClassRow[]>([]);
  const [loading, setLoading] = useState(true);

  // Booking form. The CHILD comes first: their class decides the category,
  // and the category decides which classes can host them.
  const [bookOpen, setBookOpen] = useState(false);
  const [bookKid, setBookKid] = useState("");
  // One search box, matching the child's name OR their class's title — a
  // dropdown stops working at a few dozen children (lib/makeupSearch.ts).
  const [kidQuery, setKidQuery] = useState("");
  const [bookClass, setBookClass] = useState("");
  // WHICH of the child's classes this make-up replaces. Empty when the child has
  // one (the RPC derives it) or before the admin has chosen.
  const [bookHome, setBookHome] = useState("");
  const [bookDate, setBookDate] = useState("");
  const [bookBusy, setBookBusy] = useState(false);
  const [bookError, setBookError] = useState<string | null>(null);

  // Children WITH an active enrolment — the only ones eligible (the inverse
  // of the Trials predicate).
  const [eligible, setEligible] = useState<EligibleKid[]>([]);
  // student -> parent ids, for the package-expiry advisory.
  const [parentsOf, setParentsOf] = useState<Map<string, string[]>>(new Map());
  const [livePackages, setLivePackages] = useState<LivePackage[]>([]);
  // (class_id -> off-schedule session dates) — an admin-scheduled extra
  // lesson is a real, bookable date the weekday pattern can't know about.
  const [extraDates, setExtraDates] = useState<Map<string, string[]>>(new Map());

  useEffect(() => {
    loadAll();
  }, []);

  async function loadAll() {
    setLoading(true);

    const [{ data: cls }, { data: books }, { data: kids }, { data: extras }] =
      await Promise.all([
        repo.loadActiveClasses(),
        repo.loadBookings(),
        repo.loadStudents(),
        repo.loadOffScheduleSessions(todayInSg()),
      ]);

    setClasses((cls ?? []) as ClassRow[]);

    setExtraDates(toExtraMap(extras));

    const today = todayInSg();
    const ids = (books ?? []).map((b: any) => b.student_id);
    const { data: att } = ids.length
      ? await repo.loadAttendance(ids)
      : { data: [] as any[] };

    const rows: Booking[] = toBookings(books, att);
    setUpcoming(rows.filter((r) => r.session_date >= today));
    setPast(rows.filter((r) => r.session_date < today && !r.marked));

    setEligible(toEligible(kids));

    // The expiry advisory's inputs — both fire-and-forget: without them the
    // warning simply doesn't show, and the booking still works.
    // ⚠ Do NOT await these or fold them into a Promise.all (RISK 5): that makes
    // the booking form wait on an advisory.
    const kidIds = (kids ?? []).map((k: any) => k.id);
    if (kidIds.length) {
      repo.loadParentLinks(kidIds).then(({ data }) => {
        setParentsOf(toParentsOf(data));
      });
    }
    rpc.packageLiveBalances().then(({ data }) => {
      const today2 = todayInSg();
      setLivePackages(toLivePackages(data, today2));
    });

    setLoading(false);
  }

  const kid = eligible.find((k) => k.id === bookKid);

  const homeClass = homeClassOf(kid, bookHome);

  const hostChoices = useMemo(
    () => hostChoicesFor(kid, homeClass, classes),
    [classes, kid, homeClass]
  );

  function datesFor(classId: string): string[] {
    return datesForClass(classes, extraDates, classId, todayInSg());
  }

  // ⚠ The deps omit homeClass, exactly as the page had them. Harmless today:
  // every home change also clears bookDate, which recomputes this. Kept verbatim
  // — "fixing" deps is a behaviour change (BATCH_D_PLAN.md §12).
  const expiryWarning = useMemo(
    () => expiryWarningFor(kid, bookDate, parentsOf, livePackages, homeClass),
    [kid, bookDate, parentsOf, livePackages]
  );

  const kidMatches = useMemo(
    () =>
      filterEligibleKids(
        eligible.map((k) => ({
          ...k,
          home_class_titles: k.home_classes.map((c) => c.title),
        })),
        kidQuery
      ),
    [eligible, kidQuery]
  );

  async function handleBook() {
    setBookError(null);
    if (!bookKid || !bookClass || !bookDate) return;
    setBookBusy(true);
    // book_makeup() holds every refusal — wrong category, own class, wrong
    // weekday, an already-billed month — and answers in plain sentences.
    // Show them as-is.
    const { error } = await rpc.bookMakeup({
      p_class_id: bookClass,
      p_session_date: bookDate,
      p_student_id: bookKid,
      // Named, never derived, once the child has more than one class. NULL is
      // fine for a single-class child and the RPC derives it there.
      p_home_class_id: homeClass?.id ?? null,
    });
    setBookBusy(false);
    if (error) {
      setBookError(error.message);
      return;
    }
    setBookOpen(false);
    setBookKid("");
    setKidQuery("");
    setBookHome("");
    setBookClass("");
    setBookDate("");
    await loadAll();
  }

  async function handleCancel(id: string) {
    const { error } = await rpc.cancelMakeupBooking({
      p_booking_id: id,
    });
    if (!error) await loadAll();
  }

  // Declared above the loading return: hooks must run on every render.
  const makeupSort = useTableSort<Booking>({
    key: "session_date",
    accessors: {
      marked: (b) => (b.marked ? "Marked" : "Awaiting the lesson"),
    },
  });
  const visibleUpcoming = makeupSort.apply(upcoming);

  return {
    loading,
    upcoming,
    past,
    visibleUpcoming,
    makeupSort,
    handleCancel,
    bookOpen,
    setBookOpen,
    kid,
    homeClass,
    hostChoices,
    kidQuery,
    setKidQuery,
    kidMatches,
    bookKid,
    setBookKid,
    bookHome,
    setBookHome,
    bookClass,
    setBookClass,
    bookDate,
    setBookDate,
    datesFor,
    expiryWarning,
    bookBusy,
    bookError,
    handleBook,
  };
}

export type MakeupsState = ReturnType<typeof useMakeups>;
