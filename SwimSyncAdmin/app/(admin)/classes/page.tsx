"use client";

import { useEffect, useMemo, useState } from "react";
import { Plus, Pencil, CalendarPlus, Users, Archive, RotateCcw } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { PageHeader } from "@/components/PageHeader";
import { Table, Thead, Th, Tbody, Tr, Td, useTableSort } from "@/components/Table";
import { Button } from "@/components/Button";
import { Modal } from "@/components/Modal";
import { Drawer } from "@/components/Drawer";
import { assignableClassShadows } from "@/lib/sessionRoster";
import { todayInSg, toSgDate, formatSgDate } from "@/lib/lessonDates";
import { dayOfWeekOrder } from "@/lib/tableSort";
import { formatTime } from "@/lib/utils";
import {
  buildClassRoster,
  formatStudentCount,
  describeStudentCount,
  type RosterEnrolment,
  type RosterBooking,
} from "@/lib/classRoster";
import { coverageByStudent, type StudentCoverage } from "@/lib/packageCoverage";
import { PackageChip } from "@/components/PackageChip";

type ClassRow = {
  id: string;
  title: string;
  coach_id: string;
  coach_name: string;
  day_of_week: string;
  start_time: string;
  end_time: string;
  location_name: string;
  price_per_lesson: number;
  category_id: string | null;
  student_count: number;
  /** ⚠ THE CLASS's OWN FLAG — NOT the enrolment's. `is_active` exists on
   *  `students`, on `student_class_enrolments` AND on `classes`, and this page
   *  embeds `student_class_enrolments(id, is_active)`. Reading the flag off the
   *  wrong nesting level typechecks clean and renders every class retired
   *  (§7.28). Mapped from the TOP-LEVEL row in loadClasses(). */
  is_active: boolean;
  /** When it was retired — NULL while active, and also NULL for a class made
   *  inactive before deactivate_class() existed. Shown so "retired" has a date
   *  attached rather than being a bare state. */
  deactivated_at: string | null;
};

type Coach = {
  id: string;
  full_name: string;
  /** The EARLIEST date a shadow rate is in force from, or null for none.
   *
   *  ⚠ A DATE, NOT A BOOLEAN. Payroll refuses when no shadow rate is in force
   *  ON THE LESSON'S DATE (`effective_from <= session_date`), so "they have one
   *  somewhere" is the wrong question: a rate dated next month, or an
   *  assignment backdated before the rate, silences the warning here and still
   *  blocks the whole business's payroll later. */
  shadowRateFrom: string | null;
};

/** A `class_shadow_coaches` row for the class in the drawer. */
type ShadowAssignment = {
  id: string;
  coach_id: string;
  coach_name: string;
  effective_from: string;
  effective_to: string | null;
};

const DAYS = [
  "monday","tuesday","wednesday","thursday","friday","saturday","sunday",
];

function capitalize(s: string) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function Field({
  label,
  placeholder,
  type = "text",
  value,
  onChange,
}: {
  label: string;
  placeholder: string;
  type?: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div>
      <label className="block text-sm font-medium text-gray-700 mb-1.5">
        {label}
      </label>
      <input
        type={type}
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full rounded-xl border border-gray-200 bg-gray-50 px-4 py-2.5 text-sm placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-sky-400"
      />
    </div>
  );
}

export default function ClassesPage() {
  const [classes, setClasses] = useState<ClassRow[]>([]);
  const [coaches, setCoaches] = useState<Coach[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [showModal, setShowModal] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);

  // ⚠ THE ROSTER IS FETCHED SEPARATELY FROM THE CLASS LIST, ON PURPOSE.
  //
  // PostgREST returns null for the ENTIRE select when one embed fails — a
  // policy gap, an ambiguous relationship, a typo in the nesting. Bolting
  // these joins onto loadClasses()'s select would mean any of those blanks
  // every class from this page, rather than degrading one drawer. So the
  // class list keeps the query it has always had, and the roster lives here,
  // defaulted to empty, free to fail on its own. See `docs/GOTCHAS.md` §7.52.
  const [enrolments, setEnrolments] = useState<RosterEnrolment[]>([]);
  const [bookings, setBookings] = useState<RosterBooking[]>([]);
  const [rosterError, setRosterError] = useState<string | null>(null);
  const [drawerClass, setDrawerClass] = useState<ClassRow | null>(null);
  const [shadows, setShadows] = useState<ShadowAssignment[]>([]);
  const [shadowPick, setShadowPick] = useState("");
  const [shadowFrom, setShadowFrom] = useState("");
  const [shadowBusy, setShadowBusy] = useState(false);
  const [shadowError, setShadowError] = useState<string | null>(null);
  const [covMap, setCovMap] = useState<Map<string, StudentCoverage>>(
    new Map()
  );

  // Form state
  const [title, setTitle] = useState("");
  const [coachId, setCoachId] = useState("");
  const [day, setDay] = useState("");
  const [startTime, setStartTime] = useState("");
  const [endTime, setEndTime] = useState("");
  const [location, setLocation] = useState("");
  const [rate, setRate] = useState("");
  const [original, setOriginal] = useState<{ price: number; coachId: string }>({
    price: NaN,
    coachId: "",
  });
  const [correctInPlace, setCorrectInPlace] = useState(false);

  // A category says what KIND of class this is. REQUIRED since 20260725000400:
  // it scopes prepaid packages and decides the trial price, so "no category"
  // would mean "this trial has no price". Every business has at least the two
  // defaults, created with it.
  const [categories, setCategories] = useState<{ id: string; name: string }[]>([]);
  const [categoryId, setCategoryId] = useState("");

  // ── Scheduling a lesson off the class's usual weekday ─────────────────────
  // The admin ARRANGES the lesson; the coach MARKS it. Same split as booking a
  // trial ("an arrangement, not an observation") — there is deliberately no
  // attendance-writing anywhere in this panel.
  //
  // A coach cannot do this themselves: the database refuses any session that
  // is not on the class's own weekday, and schedule_extra_lesson() is the only
  // way past that. It is admin-gated server-side, so this button is a
  // convenience rather than the control (§7.32 — a limit only the admin screen
  // applies is not a limit).
  const [extraFor, setExtraFor] = useState<ClassRow | null>(null);
  const [extraDate, setExtraDate] = useState("");
  const [extraReason, setExtraReason] = useState("");
  const [extraSaving, setExtraSaving] = useState(false);
  const [extraError, setExtraError] = useState<string | null>(null);
  const [extraDone, setExtraDone] = useState<string | null>(null);

  // ── Retiring a class ──────────────────────────────────────────────────────
  // Hidden by DEFAULT, not absent: a retired class is ordinary clutter on a
  // busy page right up until the month it blocks, and then it is the only
  // thing that matters.
  const [showRetired, setShowRetired] = useState(false);
  const [retireFor, setRetireFor] = useState<ClassRow | null>(null);
  const [retireSaving, setRetireSaving] = useState(false);
  const [restoringId, setRestoringId] = useState<string | null>(null);
  const [retireError, setRetireError] = useState<string | null>(null);

  useEffect(() => {
    loadClasses();
    loadCoaches();
    loadCategories();
    loadRoster();
  }, []);

  // The drawer's shadow list follows whichever class is open. Cleared on close
  // so the next class cannot flash the previous one's assignments.
  useEffect(() => {
    if (drawerClass) loadShadows(drawerClass.id);
    else {
      setShadows([]);
      setShadowPick("");
      setShadowFrom("");
      setShadowError(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [drawerClass?.id, coaches.length]);

  /**
   * Who is in each class — the drawer's contents, and the "+1" on the badge.
   *
   * Two queries, neither of which the class table depends on. An error here
   * leaves the table intact and shows an explicit message inside the drawer:
   * a roster we could not read must never be indistinguishable from a class
   * with nobody in it.
   */
  async function loadRoster() {
    const today = todayInSg();
    // Payment-method chips for the drawer. Fire-and-forget: a failed RPC only
    // means no chips, never a roster error.
    supabase
      .rpc("student_package_coverage")
      .then(({ data: cov }) => setCovMap(coverageByStudent(cov ?? [])));
    const [{ data: enr, error: enrErr }, { data: bk, error: bkErr }] =
      await Promise.all([
        supabase
          .from("student_class_enrolments")
          .select(
            "class_id, is_active, enrolled_at, student_id, students(full_name, tenant_levels(label))"
          )
          .eq("is_active", true),
        // Cancelled and past bookings are excluded here AND again in
        // buildClassRoster — the count must not include a guest who is not
        // coming, and one definition of "upcoming" (>= today, in SGT) is
        // already shared with the coach roster and Unassigned Children.
        supabase
          .from("trial_bookings")
          .select(
            "class_id, session_date, student_id, cancelled_at, students(full_name, tenant_levels(label))"
          )
          .is("cancelled_at", null)
          .gte("session_date", today),
      ]);

    if (enrErr || bkErr) {
      setRosterError((enrErr ?? bkErr)!.message);
      return;
    }
    setRosterError(null);

    setEnrolments(
      (enr ?? []).map((e: any) => ({
        class_id: e.class_id,
        is_active: e.is_active,
        enrolled_at: e.enrolled_at,
        student_id: e.student_id,
        full_name: e.students?.full_name ?? "—",
        // Read off the JOINED tenant_levels row, never off the student: the
        // student carries only the id, and a level's label is the business's
        // own vocabulary.
        level_label: e.students?.tenant_levels?.label ?? null,
      }))
    );
    setBookings(
      (bk ?? []).map((b: any) => ({
        class_id: b.class_id,
        session_date: b.session_date,
        student_id: b.student_id,
        cancelled_at: b.cancelled_at ?? null,
        full_name: b.students?.full_name ?? "—",
        level_label: b.students?.tenant_levels?.label ?? null,
      }))
    );
  }

  async function loadCategories() {
    const { data } = await supabase
      .from("class_categories")
      .select("id, name")
      .order("name");
    setCategories(data ?? []);
  }

  // ⚠ RETIRED CLASSES ARE LOADED, AND THAT IS LOAD-BEARING, NOT COSMETIC.
  // This used to be `.eq("is_active", true)`. Since the invoice engine stopped
  // skipping inactive classes, one of them CAN block a billing month — and the
  // coach class list and the coach Schedule tab both still filter `is_active`,
  // so this page is the only screen in the product that can show such a class
  // at all. Filter it here and `reactivate_class()` has nowhere to be called
  // from: the month blocks, nobody can see why, and there is no override on the
  // block by design. Retired rows are hidden behind the toggle below, never by
  // the query.
  async function loadClasses() {
    setLoading(true);
    const { data } = await supabase
      .from("classes")
      .select(
        "id, coach_id, title, day_of_week, start_time, end_time, location_name, price_per_lesson, category_id, is_active, deactivated_at, coaches(profiles(full_name)), student_class_enrolments(id, is_active)"
      )
      .order("day_of_week")
      .order("start_time");

    setClasses(
      (data ?? []).map((c: any) => ({
        id: c.id,
        coach_id: c.coach_id,
        title: c.title,
        coach_name: c.coaches?.profiles?.full_name ?? "—",
        day_of_week: c.day_of_week,
        start_time: c.start_time,
        end_time: c.end_time,
        location_name: c.location_name,
        price_per_lesson: Number(c.price_per_lesson),
        category_id: c.category_id ?? null,
        student_count: (c.student_class_enrolments ?? []).filter(
          (e: any) => e.is_active
        ).length,
        // c.is_active, NOT e.is_active — see the note on ClassRow (§7.28). The
        // line directly above reads the enrolment's flag; these two are one
        // character apart and mean entirely different things.
        is_active: c.is_active !== false,
        deactivated_at: c.deactivated_at ?? null,
      }))
    );
    setLoading(false);
  }

  async function loadCoaches() {
    const [{ data }, { data: shadowRates }] = await Promise.all([
      supabase.from("coaches").select("id, profiles(full_name)"),
      supabase
        .from("coach_rates")
        .select("coach_id, effective_from")
        .eq("role", "shadow"),
    ]);
    const earliestShadowRate = new Map<string, string>();
    for (const r of (shadowRates ?? []) as any[]) {
      const seen = earliestShadowRate.get(r.coach_id);
      if (!seen || r.effective_from < seen) {
        earliestShadowRate.set(r.coach_id, r.effective_from);
      }
    }
    setCoaches(
      (data ?? []).map((c: any) => ({
        id: c.id,
        full_name: c.profiles?.full_name ?? "Unknown",
        shadowRateFrom: earliestShadowRate.get(c.id) ?? null,
      }))
    );
  }

  /**
   * Who shadows the class currently open in the drawer, and who used to.
   *
   * ⚠ ENDED ASSIGNMENTS ARE SHOWN, NOT HIDDEN. An ended one still explains
   * money: pay asks "was this coach assigned on the LESSON's date", so a coach
   * who stopped shadowing in August is still paid for August and an admin
   * looking at that payout needs to see why. Hiding history here would make the
   * Wages page unexplainable.
   */
  async function loadShadows(classId: string) {
    setShadowError(null);
    const { data, error } = await supabase
      .from("class_shadow_coaches")
      .select("id, coach_id, effective_from, effective_to")
      .eq("class_id", classId)
      .order("effective_from", { ascending: false });

    if (error) {
      // A failed load must NOT render as "nobody shadows this class" — that is
      // the state an admin would then try to create, and the second assignment
      // is refused by the unique index in a way that reads as a bug.
      setShadowError(error.message);
      setShadows([]);
      return;
    }
    setShadows(
      (data ?? []).map((r: any) => ({
        id: r.id,
        coach_id: r.coach_id,
        coach_name:
          coaches.find((c) => c.id === r.coach_id)?.full_name ?? "Unknown coach",
        effective_from: r.effective_from,
        effective_to: r.effective_to,
      }))
    );
  }

  async function handleAssignShadow() {
    if (!drawerClass || !shadowPick) {
      setShadowError("Choose a coach first.");
      return;
    }
    setShadowBusy(true);
    setShadowError(null);
    const { error } = await supabase.rpc("assign_class_shadow", {
      p_class_id: drawerClass.id,
      p_coach_id: shadowPick,
      p_effective_from: shadowFrom || null,
    });
    if (error) {
      setShadowBusy(false);
      setShadowError(error.message);
      return;
    }
    setShadowPick("");
    setShadowFrom("");
    await loadShadows(drawerClass.id);
    setShadowBusy(false);
  }

  async function handleEndShadow(coachId: string) {
    if (!drawerClass) return;
    setShadowBusy(true);
    setShadowError(null);
    // ⚠ END, never DELETE. The row is what says the coach was assigned on the
    // dates it covers, and pay re-reads that for every already-paid lesson —
    // deleting it would claw back money genuinely earned (migration §1).
    const { error } = await supabase.rpc("end_class_shadow", {
      p_class_id: drawerClass.id,
      p_coach_id: coachId,
      p_effective_to: null,
    });
    if (error) {
      setShadowBusy(false);
      setShadowError(error.message);
      return;
    }
    await loadShadows(drawerClass.id);
    setShadowBusy(false);
  }

  // The price/coach the edit form OPENED with. Comparing against these is
  // what distinguishes "renamed the class" (records nothing) from "changed the
  // money" (needs a correct-vs-change decision).
  const moneyChanged =
    editingId !== null &&
    (parseFloat(rate) !== original.price || coachId !== original.coachId);

  function resetForm() {
    setOriginal({ price: NaN, coachId: "" });
    setCorrectInPlace(false);
    setTitle("");
    setCoachId("");
    setDay("");
    setStartTime("");
    setEndTime("");
    setLocation("");
    setRate("");
    setCategoryId("");
    setSaveError(null);
    setEditingId(null);
  }

  function openEdit(cls: ClassRow) {
    setOriginal({ price: Number(cls.price_per_lesson), coachId: cls.coach_id });
    setCorrectInPlace(false);
    setTitle(cls.title);
    setCoachId(cls.coach_id);
    setDay(cls.day_of_week);
    setStartTime(cls.start_time.slice(0, 5)); // "HH:MM:SS" → "HH:MM" for <input type="time">
    setEndTime(cls.end_time.slice(0, 5));
    setLocation(cls.location_name);
    setRate(String(cls.price_per_lesson));
    setCategoryId(cls.category_id ?? "");
    setSaveError(null);
    setEditingId(cls.id);
    setShowModal(true);
  }

  async function handleSubmit() {
    if (!title || !coachId || !day || !startTime || !endTime || !location || !rate) {
      setSaveError("Please fill in all fields.");
      return;
    }
    // Checked separately so the message names the field. category_id is NOT
    // NULL in the database; without this the admin would get a raw constraint
    // error naming a column the form calls something else.
    if (!categoryId) {
      setSaveError("Please choose a category.");
      return;
    }
    setSaving(true);
    setSaveError(null);

    const payload = {
      title,
      coach_id: coachId,
      day_of_week: day,
      start_time: startTime,
      end_time: endTime,
      location_name: location,
      price_per_lesson: parseFloat(rate),
      category_id: categoryId,
    };

    // Editing goes through set_class_terms, never a bare UPDATE. Price and
    // coach are EFFECTIVE-DATED in class_rates (20260719000700): writing
    // classes.price_per_lesson directly is display-only and changes nothing
    // about what anyone is charged or paid. The RPC also writes both tables in
    // one transaction, so a class's schedule and its billing terms cannot
    // disagree. Creating a class is still a plain insert — the seed trigger
    // gives it floor-dated terms.
    const { error } = editingId
      ? await supabase.rpc("set_class_terms", {
          p_class_id: editingId,
          p_title: title,
          p_day_of_week: day,
          p_start_time: startTime,
          p_end_time: endTime,
          p_location_name: location,
          p_price_per_lesson: parseFloat(rate),
          p_coach_id: coachId,
          // A correction rewrites history (there was never a period at the old
          // number); a change starts a new one from today. Only asked when the
          // money actually moved — see moneyChanged.
          p_effective_from: correctInPlace ? null : todayInSg(),
          p_correct_in_place: correctInPlace,
        })
      : await supabase.from("classes").insert({ ...payload, is_active: true });

    if (error) {
      setSaveError(error.message);
      setSaving(false);
      return;
    }

    // Category is SCOPE, not money — it says which packages can pay for this
    // class, never what a lesson costs — so it does not belong in
    // set_class_terms and is not effective-dated. A plain UPDATE alongside
    // the RPC (create includes it in the insert payload above).
    if (editingId) {
      const { error: catErr } = await supabase
        .from("classes")
        .update({ category_id: categoryId || null })
        .eq("id", editingId);
      if (catErr) {
        setSaveError(`Saved, but the category was not: ${catErr.message}`);
        setSaving(false);
        return;
      }
    }

    setSaving(false);
    setShowModal(false);
    resetForm();
    loadClasses();
  }

  function openExtra(cls: ClassRow) {
    setExtraFor(cls);
    setExtraDate("");
    setExtraReason("");
    setExtraError(null);
    setExtraDone(null);
  }

  async function handleScheduleExtra() {
    if (!extraFor) return;
    setExtraSaving(true);
    setExtraError(null);

    // Every rule here is ALSO enforced in schedule_extra_lesson(): admin only,
    // a reason required, and nothing below the window floor. Surfacing the
    // database's own message rather than pre-empting it keeps one source of
    // truth for what is allowed.
    const { error } = await supabase.rpc("schedule_extra_lesson", {
      p_class_id: extraFor.id,
      p_date: extraDate,
      p_reason: extraReason,
    });

    setExtraSaving(false);
    if (error) {
      setExtraError(error.message);
      return;
    }
    setExtraDone(extraDate);
    setExtraReason("");
    setExtraDate("");
  }

  // ── Retire / restore ──────────────────────────────────────────────────────
  // Both refusal messages come from deactivate_class() itself and are RENDERED,
  // never swallowed: each one names the children, the booked guests or the
  // unmarked dates standing in the way, which is the whole difference between
  // an instruction and a dead end. Pre-empting them here would be a second copy
  // of three rules that already live in one place.
  async function handleRetire() {
    if (!retireFor) return;
    setRetireSaving(true);
    setRetireError(null);

    const { error } = await supabase.rpc("deactivate_class", {
      p_class_id: retireFor.id,
    });

    setRetireSaving(false);
    if (error) {
      setRetireError(error.message);
      return;
    }
    setRetireFor(null);
    // Reload rather than patch in place: the row does not disappear, it changes
    // state, and the reload is what proves the round trip works from this page
    // alone.
    await loadClasses();
  }

  // No confirm, no refusal, no error surface it can get stuck behind. This is
  // the emergency exit from a class that is blocking a billing month while
  // being invisible everywhere else — anything that can stop it can strand a
  // business.
  async function handleRestore(cls: ClassRow) {
    // Guarded rather than disabled-on-a-shared-flag: two different rows must
    // never block each other, and reactivate_class() is idempotent anyway — the
    // in-flight id exists so the row can SAY something is happening.
    if (restoringId) return;
    setRestoringId(cls.id);
    setRetireError(null);

    const { error } = await supabase.rpc("reactivate_class", {
      p_class_id: cls.id,
    });

    setRestoringId(null);
    if (error) {
      // Named, because the banner sits at the top of a table that can be long
      // enough to scroll the message out of view.
      setRetireError(`Could not restore ${cls.title}: ${error.message}`);
      return;
    }
    await loadClasses();
  }

  const filtered = classes.filter(
    (c) =>
      (showRetired || c.is_active) &&
      (c.title.toLowerCase().includes(search.toLowerCase()) ||
        c.coach_name.toLowerCase().includes(search.toLowerCase()))
  );

  // One roster per class, derived once. The badge's "+N" and the drawer's
  // list read the SAME object, so the number and the names it promises can
  // never disagree. todayInSg() is read here — the caller's job — and passed
  // down; classRoster.ts itself touches no clock (§7.7).
  const rosterByClass = useMemo(() => {
    const today = todayInSg();
    const map = new Map<string, ReturnType<typeof buildClassRoster>>();
    for (const c of classes) {
      map.set(c.id, buildClassRoster(enrolments, bookings, c.id, today));
    }
    return map;
  }, [classes, enrolments, bookings]);

  const sort = useTableSort<ClassRow>({
    key: "title",
    accessors: {
      // Calendar order, not alphabetical — see dayOfWeekOrder.
      day_of_week: (c) => dayOfWeekOrder(c.day_of_week),
      // The enrolled count only. The badge reads "2+1"; sorting by the string
      // would order it as text, and sorting by enrolled+trials would rank a
      // class of 2 with a guest above a class of 3 weekly students.
      student_count: (c) => c.student_count,
    },
  });
  const visible = sort.apply(filtered);

  const openRoster = rosterByClass.get(drawerClass?.id ?? "") ?? {
    enrolled: [],
    trials: [],
  };

  const activeCount = classes.filter((c) => c.is_active).length;
  const retiredCount = classes.length - activeCount;

  return (
    <div>
      <PageHeader
        title="Classes"
        // Counted, not `classes.length` — that array now carries retired classes
        // too, and this line would have quietly started overstating the number
        // of classes the business actually runs.
        subtitle={`${retiredCount > 0
          ? `${activeCount} active · ${retiredCount} retired`
          : `${activeCount} active classes`}`}
        action={
          <Button
            onClick={() => {
              resetForm();
              setShowModal(true);
            }}
          >
            <Plus className="h-4 w-4" />
            New Class
          </Button>
        }
      />

      <div className="mb-4 flex flex-wrap items-center gap-4">
        <input
          type="text"
          placeholder="Search by class name or coach..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-full max-w-sm rounded-xl border border-gray-200 bg-white px-4 py-2.5 text-sm placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-sky-400"
        />
        {/* Always offered, even at zero, so the answer to "where did that class
            go?" is on the page rather than in someone's memory. */}
        <label className="inline-flex items-center gap-2 text-sm text-gray-600">
          <input
            type="checkbox"
            checked={showRetired}
            onChange={(e) => setShowRetired(e.target.checked)}
            className="h-4 w-4 rounded border-gray-300 text-sky-600 focus:ring-sky-400"
          />
          Show retired classes
          {retiredCount > 0 && (
            <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs font-semibold text-gray-600">
              {retiredCount}
            </span>
          )}
        </label>
      </div>

      {/* reactivate_class() cannot refuse, so this only ever carries a network
          or permission failure — but a restore that silently did nothing is
          exactly the dead end this page exists to prevent. */}
      {retireError && retireFor === null && (
        <div className="mb-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {retireError}
        </div>
      )}

      <Table>
        <Thead>
          <Th sort={sort} sortKey="title">Class Name</Th>
          <Th sort={sort} sortKey="coach_name">Coach</Th>
          <Th sort={sort} sortKey="day_of_week">Day</Th>
          <Th sort={sort} sortKey="start_time">Time</Th>
          <Th sort={sort} sortKey="location_name">Location</Th>
          <Th sort={sort} sortKey="price_per_lesson" firstDir="desc">Rate</Th>
          <Th sort={sort} sortKey="student_count" firstDir="desc">Students</Th>
          <Th>Actions</Th>
        </Thead>
        <Tbody>
          {loading ? (
            <Tr>
              <Td className="text-center text-gray-400 py-8" colSpan={8}>
                Loading…
              </Td>
            </Tr>
          ) : visible.length === 0 ? (
            <Tr>
              <Td className="text-center text-gray-400 py-8" colSpan={8}>
                No classes found.
              </Td>
            </Tr>
          ) : (
            visible.map((cls) => (
              <Tr key={cls.id}>
                <Td className="font-medium text-gray-900">
                  {cls.title}
                  {!cls.is_active && (
                    <span
                      className="ml-2 inline-flex items-center rounded-full bg-gray-100 px-2 py-0.5 text-xs font-semibold text-gray-600 align-middle"
                      title={
                        cls.deactivated_at
                          // toSgDate takes the ISO string and converts in SGT.
                          // new Date(...).toISOString().split("T")[0] here would
                          // be the UTC date — a day early before 08:00 (§7.7).
                          ? `Retired on ${formatSgDate(toSgDate(cls.deactivated_at), {
                              day: "numeric",
                              month: "short",
                              year: "numeric",
                            })}`
                          : "Retired before SwimSync recorded retirement dates"
                      }
                    >
                      Retired
                    </span>
                  )}
                </Td>
                <Td className="text-gray-600">{cls.coach_name}</Td>
                <Td>{capitalize(cls.day_of_week)}</Td>
                <Td className="text-gray-500">
                  {formatTime(cls.start_time)} – {formatTime(cls.end_time)}
                </Td>
                <Td className="text-gray-500">{cls.location_name}</Td>
                <Td className="font-medium">
                  S${cls.price_per_lesson.toFixed(2)}
                </Td>
                <Td>
                  {/* "2+1", never "3". The enrolled half comes from the class
                      query's own embed, so this number survives even if the
                      roster query failed; the "+1" is trials, and it is a
                      separate number because a guest at one lesson is not a
                      weekly student (PRD §7.17). */}
                  <button
                    onClick={() => setDrawerClass(cls)}
                    title={describeStudentCount(
                      cls.student_count,
                      rosterByClass.get(cls.id)?.trials.length ?? 0
                    )}
                    className="inline-flex items-center justify-center rounded-full bg-sky-50 px-2.5 py-0.5 text-xs font-semibold text-sky-700 hover:bg-sky-100"
                  >
                    {formatStudentCount(
                      cls.student_count,
                      rosterByClass.get(cls.id)?.trials.length ?? 0
                    )}
                  </button>
                </Td>
                <Td>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => setDrawerClass(cls)}
                      className="inline-flex items-center gap-1 whitespace-nowrap rounded-lg border border-gray-200 px-2.5 py-1 text-xs font-medium text-gray-600 hover:bg-gray-50"
                    >
                      <Users className="h-3.5 w-3.5 shrink-0" />
                      See students
                    </button>
                    <button
                      onClick={() => openEdit(cls)}
                      className="inline-flex items-center gap-1 rounded-lg border border-gray-200 px-2.5 py-1 text-xs font-medium text-gray-600 hover:bg-gray-50"
                    >
                      <Pencil className="h-3.5 w-3.5" />
                      Edit
                    </button>
                    {/* NOT offered on a retired class. schedule_extra_lesson()
                        has no is_active guard of its own, so this would write a
                        lesson_sessions row on a class the coach's class list and
                        Schedule tab both filter out: a lesson that exists, can
                        never be marked, and can never bill. It would not even
                        block the month — the engine bails on an empty billable
                        set — so it fails silently in both directions. Hiding the
                        button is the UI half; §7.32 says a limit only the admin
                        screen applies is not a limit, and the server-side half
                        is filed rather than fixed here. Restore first. */}
                    {cls.is_active && (
                      <button
                        onClick={() => openExtra(cls)}
                        className="inline-flex items-center gap-1 rounded-lg border border-gray-200 px-2.5 py-1 text-xs font-medium text-gray-600 hover:bg-gray-50"
                        title="Schedule a lesson on a day this class does not normally run"
                      >
                        <CalendarPlus className="h-3.5 w-3.5" />
                        Extra lesson
                      </button>
                    )}
                    {cls.is_active ? (
                      <button
                        onClick={() => {
                          setRetireError(null);
                          setRetireFor(cls);
                        }}
                        className="inline-flex items-center gap-1 whitespace-nowrap rounded-lg border border-gray-200 px-2.5 py-1 text-xs font-medium text-gray-600 hover:bg-gray-50"
                        title="Stop scheduling this class. Lessons it already taught still bill."
                      >
                        <Archive className="h-3.5 w-3.5 shrink-0" />
                        Retire
                      </button>
                    ) : (
                      // No confirm on the way back. This is the exit from a
                      // class that can block a billing month while being
                      // invisible to every other screen.
                      <button
                        onClick={() => handleRestore(cls)}
                        className="inline-flex items-center gap-1 whitespace-nowrap rounded-lg border border-sky-200 bg-sky-50 px-2.5 py-1 text-xs font-medium text-sky-700 hover:bg-sky-100"
                        title="Put this class back on the schedule"
                      >
                        <RotateCcw className="h-3.5 w-3.5 shrink-0" />
                        {restoringId === cls.id ? "Restoring…" : "Restore"}
                      </button>
                    )}
                  </div>
                </Td>
              </Tr>
            ))
          )}
        </Tbody>
      </Table>

      {/* Retire a class.
          The three refusals are enforced in deactivate_class() and their
          messages are shown verbatim below — they name the children, the booked
          guests or the unmarked dates in the way. This is an ordinary React
          dialog, not Alert.alert: this is the Next.js panel, and the RN-web
          no-op does not apply here. */}
      <Modal
        title={retireFor ? `Retire ${retireFor.title}?` : "Retire class"}
        open={retireFor !== null}
        onClose={() => {
          setRetireFor(null);
          setRetireError(null);
        }}
      >
        <div className="space-y-4">
          <p className="text-sm text-gray-600">
            This class stops being scheduled. It disappears from the coach&apos;s
            app, and no new lessons can be marked on it.
          </p>
          <p className="text-sm text-gray-600">
            <span className="font-medium text-gray-900">
              Lessons it has already taught still bill as normal.
            </span>{" "}
            You can put it back at any time with <em>Restore</em>.
          </p>

          {retireError && (
            <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
              {retireError}
            </div>
          )}

          <div className="flex justify-end gap-2 pt-1">
            <Button
              variant="outline"
              onClick={() => {
                setRetireFor(null);
                setRetireError(null);
              }}
            >
              Cancel
            </Button>
            <Button onClick={handleRetire} disabled={retireSaving}>
              {retireSaving ? "Retiring…" : "Retire class"}
            </Button>
          </div>
        </div>
      </Modal>

      {/* Schedule an extra lesson */}
      <Modal
        title={
          extraFor ? `Extra lesson — ${extraFor.title}` : "Extra lesson"
        }
        open={extraFor !== null}
        onClose={() => setExtraFor(null)}
      >
        <div className="space-y-4">
          <p className="text-sm text-gray-500">
            A lesson on a day this class does not normally run — a makeup, or a
            public-holiday shift.{" "}
            <span className="text-gray-700">
              {extraFor ? capitalize(extraFor.day_of_week) : ""} lessons need no
              scheduling
            </span>
            ; the coach marks those as usual.
          </p>

          <Field
            label="Date"
            placeholder=""
            value={extraDate}
            onChange={setExtraDate}
            type="date"
          />

          <Field
            label="Reason"
            value={extraReason}
            onChange={setExtraReason}
            placeholder="e.g. Makeup for the National Day holiday"
          />
          <p className="-mt-2 text-xs text-gray-400">
            The coach sees this on their class, so they know why the lesson is
            there.
          </p>

          {extraError && (
            <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
              {extraError}
            </p>
          )}

          {extraDone && (
            <p className="rounded-lg bg-green-50 px-3 py-2 text-sm text-green-700">
              Scheduled for {extraDone}. It now appears on the coach&apos;s class,
              and the month will not close until they have marked it.
            </p>
          )}

          <div className="flex justify-end gap-2 pt-2">
            <button
              onClick={() => setExtraFor(null)}
              className="rounded-xl px-4 py-2 text-sm font-medium text-gray-600 hover:bg-gray-50"
            >
              Close
            </button>
            <Button
              onClick={handleScheduleExtra}
              disabled={extraSaving || !extraDate || !extraReason.trim()}
            >
              {extraSaving ? "Scheduling…" : "Schedule lesson"}
            </Button>
          </div>
        </div>
      </Modal>

      {/* Who is in this class — read-only, two groups, never merged.
          DELIBERATELY NO WRITE CONTROLS. Not an oversight: the one action an
          admin might reach for here is assigning a trial child to the class,
          and that is precisely the action that breaks billing (PRD §7.17).
          Do NOT add Assign / Enrol / Remove buttons to this drawer. */}
      <Drawer
        open={drawerClass !== null}
        onClose={() => setDrawerClass(null)}
        title={drawerClass?.title ?? ""}
        subtitle={
          drawerClass
            ? `${capitalize(drawerClass.day_of_week)} · ${formatTime(
                drawerClass.start_time
              )} – ${formatTime(drawerClass.end_time)} · ${
                drawerClass.location_name
              }`
            : undefined
        }
      >
        {rosterError ? (
          <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">
            Couldn&apos;t load the roster: {rosterError}
          </p>
        ) : (
          <div className="space-y-8">
            <section>
              <h3 className="text-sm font-semibold text-gray-900">
                Shadow coaches
              </h3>
              <p className="mt-0.5 text-xs text-gray-500">
                A shadow watches every lesson of this class and is paid their own
                shadow rate for each one. It lasts until you end it — this is not
                a per-lesson arrangement. To record a one-off cover instead, use{" "}
                <span className="font-medium">Substitutes</span>.
              </p>

              {shadowError && (
                <p className="mt-2 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">
                  {shadowError}
                </p>
              )}

              {shadows.length > 0 && (
                <ul className="mt-3 space-y-1.5">
                  {shadows.map((sh) => (
                    <li
                      key={sh.id}
                      className="flex flex-wrap items-center gap-2 text-sm"
                    >
                      <span className="font-medium text-gray-900">
                        {sh.coach_name}
                      </span>
                      <span className="text-xs text-gray-500">
                        {formatSgDate(sh.effective_from)} –{" "}
                        {sh.effective_to
                          ? formatSgDate(sh.effective_to)
                          : "ongoing"}
                      </span>
                      {sh.effective_to === null ? (
                        <button
                          type="button"
                          disabled={shadowBusy}
                          onClick={() => handleEndShadow(sh.coach_id)}
                          className="text-xs font-medium text-gray-500 underline disabled:opacity-50"
                        >
                          End
                        </button>
                      ) : (
                        <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-600">
                          ended
                        </span>
                      )}
                    </li>
                  ))}
                </ul>
              )}

              <div className="mt-3 flex flex-wrap items-center gap-2">
                <select
                  value={shadowPick}
                  onChange={(e) => setShadowPick(e.target.value)}
                  className="rounded-lg border border-gray-200 px-2 py-1 text-sm"
                >
                  <option value="">Add a shadow…</option>
                  {assignableClassShadows(
                    drawerClass?.coach_id ?? "",
                    shadows
                      .filter((sh) => sh.effective_to === null)
                      .map((sh) => sh.coach_id),
                    coaches.map((c) => ({ id: c.id, name: c.full_name }))
                  ).map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
                <input
                  type="date"
                  value={shadowFrom}
                  onChange={(e) => setShadowFrom(e.target.value)}
                  className="rounded-lg border border-gray-200 px-2 py-1 text-sm"
                  aria-label="Shadowing from"
                />
                <button
                  type="button"
                  disabled={shadowBusy || !shadowPick}
                  onClick={handleAssignShadow}
                  className="rounded-lg bg-sky-500 px-3 py-1 text-sm font-medium text-white disabled:opacity-50"
                >
                  Add
                </button>
                <span className="text-xs text-gray-400">
                  from today if left blank
                </span>
              </div>

              {/* Met HERE rather than at payroll, deliberately. A shadow with no
                  shadow rate makes generate_coach_payouts refuse for the WHOLE
                  business, months later, with the run blocked until somebody
                  works out why. Here it costs one sentence. */}
              {(() => {
                if (!shadowPick) return null;
                const from = coaches.find((c) => c.id === shadowPick)
                  ?.shadowRateFrom;
                // Compared against the date the ASSIGNMENT starts, because that
                // is the earliest lesson payroll will price for them.
                const startsOn = shadowFrom || todayInSg();
                if (from && from <= startsOn) return null;
                return (
                  <p className="mt-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
                    {from
                      ? `This coach's shadow rate only starts on ${formatSgDate(from)}, after this assignment does.`
                      : "This coach has no shadow rate yet."}{" "}
                    Set one on <span className="font-medium">Wages</span> before
                    payroll — without a rate in force the whole business&apos;s
                    payroll run will refuse rather than pay the wrong rate.
                  </p>
                );
              })()}
            </section>

            <section>
              <h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-gray-500">
                Enrolled ({openRoster.enrolled.length})
              </h3>
              {openRoster.enrolled.length === 0 ? (
                <p className="text-sm text-gray-400">
                  Nobody is enrolled in this class yet.
                </p>
              ) : (
                <ul className="divide-y divide-gray-100">
                  {openRoster.enrolled.map((s) => (
                    <li key={s.student_id} className="py-2.5">
                      <p className="text-sm font-medium text-gray-900">
                        {s.full_name}
                        <span className="ml-1.5">
                          <PackageChip coverage={covMap.get(s.student_id)} />
                        </span>
                      </p>
                      <p className="mt-0.5 text-xs text-gray-500">
                        {s.level_label ?? "No level set"} · Joined{" "}
                        {formatSgDate(toSgDate(s.enrolled_at), {
                          day: "numeric",
                          month: "short",
                          year: "numeric",
                        })}
                      </p>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            {openRoster.trials.length > 0 && (
              <section>
                <h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-gray-500">
                  Trials coming up ({openRoster.trials.length})
                </h3>
                <ul className="divide-y divide-gray-100">
                  {openRoster.trials.map((t) => (
                    <li key={t.student_id} className="py-2.5">
                      <p className="text-sm font-medium text-gray-900">
                        {t.full_name}
                        <span className="ml-1.5">
                          <PackageChip coverage={covMap.get(t.student_id)} />
                        </span>
                      </p>
                      <p className="mt-0.5 text-xs text-gray-500">
                        {t.level_label ?? "No level set"} · Trial on{" "}
                        {formatSgDate(t.session_date)}
                      </p>
                    </li>
                  ))}
                </ul>
                {/* The consequence, in words. A reader who takes the "+1" for
                    class membership is one click from breaking a billing
                    month, so the screen says what would happen. */}
                <p className="mt-3 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
                  A guest for this one lesson — not part of the class. Adding
                  them to it would make them expected every week, and a lesson
                  nobody marks blocks the whole month from being invoiced.
                </p>
              </section>
            )}
          </div>
        )}
      </Drawer>

      {/* Create / Edit Class Modal */}
      <Modal
        title={editingId ? "Edit Class" : "Create New Class"}
        open={showModal}
        onClose={() => setShowModal(false)}
      >
        <div className="space-y-4">
          <Field
            label="Class Name"
            placeholder="e.g. Saturday Beginners"
            value={title}
            onChange={setTitle}
          />

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">
              Coach
            </label>
            <select
              value={coachId}
              onChange={(e) => setCoachId(e.target.value)}
              className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-sky-400"
            >
              <option value="">— Choose a coach —</option>
              {coaches.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.full_name}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">
              Day
            </label>
            <select
              value={day}
              onChange={(e) => setDay(e.target.value)}
              className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-sky-400"
            >
              <option value="">— Choose a day —</option>
              {DAYS.map((d) => (
                <option key={d} value={d}>
                  {capitalize(d)}
                </option>
              ))}
            </select>
          </div>

          {/* Rendered unconditionally now: a category is REQUIRED, so hiding
              the field when a business has none would leave no way to satisfy
              it. Every business has at least the two defaults. */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">
              Category <span className="text-red-500">*</span>
            </label>
            <select
              value={categoryId}
              onChange={(e) => setCategoryId(e.target.value)}
              className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-sky-400"
            >
              {/* No "— None —": classes.category_id is NOT NULL
                  (20260725000400), and an option the database refuses is not
                  an option. The empty value is an unmade choice, not a
                  selectable one — the same reason the day-of-week picker
                  stopped defaulting (§8e). */}
              <option value="">Choose a category…</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
            <p className="mt-1 text-xs text-gray-500">
              What kind of class this is. It decides which prepaid packages can
              pay for it, and what a <strong>trial</strong> of this class costs.
              It does <em>not</em> set the lesson price — that is per class,
              above.
            </p>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <Field
              label="Start Time"
              placeholder="09:00"
              type="time"
              value={startTime}
              onChange={setStartTime}
            />
            <Field
              label="End Time"
              placeholder="10:00"
              type="time"
              value={endTime}
              onChange={setEndTime}
            />
          </div>

          <Field
            label="Location"
            placeholder="e.g. Buona Vista SC"
            value={location}
            onChange={setLocation}
          />
          <Field
            label="Rate per Lesson (S$)"
            placeholder="40"
            type="number"
            value={rate}
            onChange={setRate}
          />

          {/* Only asked when the money actually moved. These are genuinely
              different intents and the wrong one is expensive either way: a
              correction rewrites what past lessons were worth, while a change
              leaves them alone. Defaulting silently would make every typo
              permanent fictional history, or every price rise reach backwards
              into months already taught. */}
          {moneyChanged && (
            <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 space-y-2">
              <p className="text-sm font-medium text-amber-900">
                You changed the price or coach. Which is this?
              </p>
              <label className="flex items-start gap-2 text-sm text-amber-900">
                <input
                  type="radio"
                  className="mt-1"
                  checked={!correctInPlace}
                  onChange={() => setCorrectInPlace(false)}
                />
                <span>
                  <strong>A change from today.</strong> Lessons already taught
                  keep the old rate, and invoices and coach pay for them are
                  unaffected.
                </span>
              </label>
              <label className="flex items-start gap-2 text-sm text-amber-900">
                <input
                  type="radio"
                  className="mt-1"
                  checked={correctInPlace}
                  onChange={() => setCorrectInPlace(true)}
                />
                <span>
                  <strong>Fixing a mistake.</strong> The old value was never
                  right, so past lessons are re-valued too. Blocked if the month
                  has already been invoiced or paid out.
                </span>
              </label>
            </div>
          )}

          {saveError && (
            <p className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">
              {saveError}
            </p>
          )}

          <div className="flex gap-3 pt-2">
            <Button
              variant="outline"
              className="flex-1"
              onClick={() => setShowModal(false)}
            >
              Cancel
            </Button>
            <Button
              className="flex-1"
              disabled={saving}
              onClick={handleSubmit}
            >
              {saving ? "Saving…" : editingId ? "Save Changes" : "Create Class"}
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
