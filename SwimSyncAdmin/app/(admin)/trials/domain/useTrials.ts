import { useEffect, useState } from "react";
import { useTableSort } from "@/components/Table";
import { coverageByStudent, type StudentCoverage } from "@/lib/packageCoverage";
import { todayInSg, formatSgDate } from "@/lib/lessonDates";
import * as repo from "../dao/trials.repo";
import * as rpc from "../dao/trials.rpc";
import { datesForClass, toBookings, toCategories, toEligible } from "./trialRows";
import { needsConvertConfirmation } from "./trialConvert";
import type { Booking, Category, ClassRow } from "../types";

// All Trials state, loads and writes (Admin L-D, BATCH_D_PLAN.md).
//
// ⚠ EVERY hook the page had lives here — including the four convert useStates
// that sat mid-component, and both useTableSorts — so the page calls this once
// and only THEN returns early while loading (RISK 3: hook order). The sorts also
// must not move into ui/: loadAll() flips `loading`, which unmounts everything
// below the early return, so a ui/-held sort would reset after every write.
//
// ⚠ RISK 2: handleConvert's await boundaries are the two-press guard. The
// future-trial read, the enrolment insert and the status update stay three
// separate dao calls, in this order, awaited here.
export function useTrials() {
  const [upcoming, setUpcoming] = useState<Booking[]>([]);
  const [past, setPast] = useState<Booking[]>([]);
  const [classes, setClasses] = useState<ClassRow[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);
  const [tenantId, setTenantId] = useState<string | null>(null);

  // Booking form
  const [bookOpen, setBookOpen] = useState(false);
  const [bookName, setBookName] = useState("");
  const [bookExisting, setBookExisting] = useState("");
  const [bookClass, setBookClass] = useState("");
  const [bookDate, setBookDate] = useState("");
  const [bookPhone, setBookPhone] = useState("");
  const [bookEmail, setBookEmail] = useState("");
  const [bookBusy, setBookBusy] = useState(false);
  const [bookError, setBookError] = useState<string | null>(null);
  // Children with no ACTIVE enrolment — the only ones eligible for a trial.
  const [eligible, setEligible] = useState<{ id: string; full_name: string }[]>([]);

  // Rates
  const [rateDraft, setRateDraft] = useState<Record<string, string>>({});
  const [rateBusy, setRateBusy] = useState<string | null>(null);
  const [rateError, setRateError] = useState<string | null>(null);
  const [covMap, setCovMap] = useState<Map<string, StudentCoverage>>(
    new Map()
  );

  // Payment-method chips: fire-and-forget, a failed RPC only means no chips.
  useEffect(() => {
    rpc
      .studentPackageCoverage()
      .then(({ data: cov }) => setCovMap(coverageByStudent(cov ?? [])));
  }, []);

  useEffect(() => {
    loadAll();
  }, []);

  async function loadAll() {
    setLoading(true);
    const { data: auth } = await repo.getAuthUser();
    const { data: profile } = await repo.profileTenant(auth.user?.id ?? "");
    const tid = (profile?.tenant_id as string | null) ?? null;
    setTenantId(tid);

    const [{ data: cls }, { data: cats }, { data: rates }, { data: books }] =
      await Promise.all([
        repo.loadActiveClasses(),
        repo.loadCategories(),
        repo.loadTrialRates(),
        repo.loadBookings(),
      ]);

    setClasses((cls ?? []) as ClassRow[]);

    // The rate a category is on TODAY — the newest row not dated in the future.
    // Older rows still price older lessons; this display is only "what would a
    // trial booked now cost".
    const today = todayInSg();
    setCategories(toCategories(cats, rates, today));

    // Which bookings have been marked? A booking whose lesson has passed and
    // is NOT marked is what holds the month open, so it gets its own list.
    const ids = (books ?? []).map((b: any) => b.student_id);
    const { data: att } = ids.length
      ? await repo.loadAttendance(ids)
      : { data: [] as any[] };
    const rows: Booking[] = toBookings(books, att);

    setUpcoming(rows.filter((r) => r.session_date >= today));
    setPast(rows.filter((r) => r.session_date < today && !r.marked));

    // Eligible children: in this business, active, and NOT currently in a class.
    const { data: kids } = await repo.loadStudents();
    setEligible(toEligible(kids));

    setLoading(false);
  }

  function datesFor(classId: string): string[] {
    return datesForClass(classes, classId, todayInSg());
  }

  async function handleBook() {
    setBookError(null);
    if (!bookClass || !bookDate) return;
    // ⚠ THE PHONE IS REQUIRED FOR A NEW CHILD, AND IT IS THE POINT.
    // It is the only signal that survives how a name is actually written:
    // "Ethan Tan Ah Beng" vs "Tan Ah Beng Ethan", English vs dialect, nickname
    // vs full name. Without it, matching this child to their parent later falls
    // back to name guessing. A trial booking is also the one moment the coach
    // certainly has the number — they need to reach the family anyway.
    if (!bookExisting && !bookPhone.trim()) {
      setBookError("A contact number is needed so this child can be matched to their parent's account later.");
      return;
    }
    if (!bookExisting && !bookName.trim()) {
      setBookError("Enter a name, or choose a child already in SwimSync.");
      return;
    }
    setBookBusy(true);

    const { error } = bookExisting
      ? await rpc.bookTrial({
          p_class_id: bookClass,
          p_session_date: bookDate,
          p_student_id: bookExisting,
        })
      : await rpc.addUnclaimedStudent({
          p_class_id: bookClass,
          p_full_name: bookName.trim(),
          p_kind: "trial",
          p_session_date: bookDate,
          p_contact_phone: bookPhone.trim() || null,
          p_contact_email: bookEmail.trim() || null,
        });

    setBookBusy(false);
    if (error) {
      // book_trial() returns plain sentences for its refusals — already
      // enrolled, holds a package, wrong weekday. Show them as-is.
      setBookError(error.message);
      return;
    }
    setBookOpen(false);
    setBookName("");
    setBookExisting("");
    setBookPhone("");
    setBookEmail("");
    await loadAll();
  }

  async function handleCancel(id: string) {
    const { error } = await rpc.cancelTrialBooking({
      p_booking_id: id,
    });
    if (!error) await loadAll();
  }

  // ── Convert a trial to an enrolment ─────────────────────────────────────────
  // The child tried this class; converting enrols them into THAT class, reusing
  // the exact insert Unassigned Children performs. See domain/trialConvert.ts for
  // the RISK 1 reasoning behind the two-press guard.
  const [convertTarget, setConvertTarget] = useState<Booking | null>(null);
  const [convertBusy, setConvertBusy] = useState(false);
  const [convertError, setConvertError] = useState<string | null>(null);
  const [convertConfirmed, setConvertConfirmed] = useState(false);

  function openConvert(b: Booking) {
    setConvertTarget(b);
    setConvertError(null);
    setConvertConfirmed(false);
  }

  async function handleConvert() {
    if (!convertTarget) return;
    const kid = convertTarget.student_id;
    const classId = convertTarget.class_id;
    if (!classId) {
      setConvertError(
        "This trial has no class on record, so there is nothing to enrol into. " +
          "Enrol the child from Unassigned Children instead.",
      );
      return;
    }
    setConvertBusy(true);
    setConvertError(null);

    // ⚠ RISK 1 — a FUTURE live trial means enrolling stacks a permanent
    // enrolment on a still-unmarked booking, which blocks the billing month.
    // The past trial being converted is in the past, so this query never
    // returns it. Same query Unassigned Children runs (unassigned/page.tsx).
    const todaySg = todayInSg();
    const { data: liveTrial } = await repo.loadFutureLiveTrial(kid, todaySg);

    if (
      needsConvertConfirmation({
        hasFutureTrial: (liveTrial ?? []).length > 0,
        alreadyConfirmed: convertConfirmed,
      })
    ) {
      setConvertError(
        `${convertTarget.student_name} still has a trial booked for ` +
          `${formatSgDate(liveTrial![0].session_date)}. Enrolling makes them ` +
          `expected EVERY week, and that unmarked trial will block invoicing. ` +
          `Press Convert again if you really mean to enrol them now.`,
      );
      setConvertConfirmed(true);
      setConvertBusy(false);
      return;
    }

    const { error: enrolError } = await repo.insertEnrolment(kid, classId);
    if (enrolError) {
      // The enrolment-overlap trigger (§8.43) and any other refusal come back
      // as a plain message — show it as-is rather than assume success.
      setConvertError(enrolError.message);
      setConvertBusy(false);
      return;
    }

    const { error: statusError } = await repo.markAssigned(kid);
    setConvertBusy(false);
    if (statusError) {
      // Enrolment DID succeed — say so rather than swallow it (the Unassigned
      // page ignores this error; we do not). Reload so the new enrolment shows.
      setConvertError(
        `Enrolled, but their status could not be updated (${statusError.message}). ` +
          `They may still appear under Unassigned Children.`,
      );
      await loadAll();
      return;
    }

    setConvertTarget(null);
    setConvertConfirmed(false);
    // The past trial row deliberately STAYS on the needs-marking list — the
    // trial lesson itself is still unmarked and still holds the month open.
    await loadAll();
  }

  async function handleSaveRate(categoryId: string) {
    const raw = rateDraft[categoryId];
    const value = Number(raw);
    if (!(value > 0)) {
      setRateError("A trial price must be more than zero.");
      return;
    }
    setRateBusy(categoryId);
    setRateError(null);
    const { data: auth } = await repo.getAuthUser();
    // A new effective-dated ROW, never an update. Changing the price must not
    // re-value trials already taught (§7.3).
    const { error } = await repo.insertTrialRate({
      tenant_id: tenantId,
      category_id: categoryId,
      rate: value,
      effective_from: todayInSg(),
      created_by: auth.user?.id,
    });
    setRateBusy(null);
    if (error) {
      setRateError(error.message);
      return;
    }
    setRateDraft((p) => ({ ...p, [categoryId]: "" }));
    await loadAll();
  }

  const unpriced = categories.filter((c) => c.rate === null);

  // Declared above the page's `if (loading)` return: these call useState, and a
  // hook after a conditional return is a hook that sometimes does not run.
  const trialSort = useTableSort<Booking>({
    key: "session_date",
    accessors: {
      // "Awaiting the lesson" before "Marked" is the useful order: an unmarked
      // trial is the one still needing something to happen.
      marked: (b) => (b.marked ? "Marked" : "Awaiting the lesson"),
    },
  });
  const visibleTrials = trialSort.apply(upcoming);

  const categorySort = useTableSort<Category>({ key: "name" });
  const visibleCategories = categorySort.apply(categories);

  return {
    loading,
    upcoming,
    past,
    classes,
    covMap,
    bookOpen,
    setBookOpen,
    bookName,
    setBookName,
    bookExisting,
    setBookExisting,
    bookClass,
    setBookClass,
    bookDate,
    setBookDate,
    bookPhone,
    setBookPhone,
    bookEmail,
    setBookEmail,
    bookBusy,
    bookError,
    eligible,
    rateDraft,
    setRateDraft,
    rateBusy,
    rateError,
    datesFor,
    handleBook,
    handleCancel,
    convertTarget,
    setConvertTarget,
    convertBusy,
    convertError,
    convertConfirmed,
    openConvert,
    handleConvert,
    handleSaveRate,
    unpriced,
    trialSort,
    visibleTrials,
    categorySort,
    visibleCategories,
  };
}

export type TrialsState = ReturnType<typeof useTrials>;
