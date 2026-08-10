"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabase";
import { PageHeader } from "@/components/PageHeader";
import { Table, Thead, Th, Tbody, Tr, Td, useTableSort } from "@/components/Table";
import { Button } from "@/components/Button";
import { Modal } from "@/components/Modal";
import {
  todayInSg,
  formatSgDate,
  expectedLessonDates,
  type DayOfWeek,
} from "@/lib/lessonDates";
import { filterEligibleKids } from "@/lib/makeupSearch";

/**
 * Make-ups — an ENROLLED child guesting into one lesson of ANOTHER class in
 * the same category, to make up a missed lesson (rain, illness, a parent
 * cancellation). The mirror of Trials: a trial is for a child not yet in a
 * class; a make-up is for a child already in one.
 *
 * A make-up is NOT an enrolment and NOT attendance. Booking says only "this
 * child is expected at this one lesson"; the coach marks them like anyone
 * else. A package family's attended make-up draws from the package; an ad-hoc
 * family pays their OWN class's price for it, not the host's.
 *
 * WHY A PAGE rather than a button on Students: a booking you cannot see is a
 * booking you forget, and a forgotten one HOLDS THE BILLING MONTH OPEN. The
 * "Past — needs marking" list is the important half of this screen.
 */

type Booking = {
  id: string;
  session_date: string;
  student_id: string;
  student_name: string;
  class_title: string;
  marked: boolean;
};

type ClassRow = {
  id: string;
  title: string;
  day_of_week: DayOfWeek;
  category_id: string;
};

type EligibleKid = {
  id: string;
  full_name: string;
  /** EVERY class the child is in. Since Wave 2 (`20260811000100`) a make-up
   *  needs to know WHICH of them it replaces — book_makeup() refuses to guess
   *  once there is more than one, because the class it picked would price the
   *  invoice line and decide package coverage. */
  home_classes: { id: string; title: string; category_id: string }[];
};

type LivePackage = {
  parent_id: string;
  category_id: string | null;
  expires_on: string;
  live_lessons_remaining: number;
};

export default function MakeupsPage() {
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
        supabase
          .from("classes")
          .select("id, title, day_of_week, category_id")
          .eq("is_active", true)
          .order("title"),
        supabase
          .from("makeup_bookings")
          .select(
            "id, session_date, student_id, students(full_name), classes!makeup_bookings_class_id_fkey(title)"
          )
          .is("cancelled_at", null)
          .order("session_date"),
        supabase
          .from("students")
          .select(
            "id, full_name, is_active, student_class_enrolments(is_active, classes(id, title, category_id))"
          )
          .order("full_name"),
        supabase
          .from("lesson_sessions")
          .select("class_id, session_date")
          .not("off_schedule_reason", "is", null)
          .gte("session_date", todayInSg()),
      ]);

    setClasses((cls ?? []) as ClassRow[]);

    const extraMap = new Map<string, string[]>();
    for (const e of extras ?? []) {
      const list = extraMap.get(e.class_id as string) ?? [];
      list.push(e.session_date as string);
      extraMap.set(e.class_id as string, list);
    }
    setExtraDates(extraMap);

    // Marked = an attendance row exists for that child on that date. Same
    // student+date approximation the Trials page uses.
    const today = todayInSg();
    const ids = (books ?? []).map((b: any) => b.student_id);
    const { data: att } = ids.length
      ? await supabase
          .from("attendance")
          .select("student_id, lesson_sessions(session_date)")
          .in("student_id", ids)
      : { data: [] as any[] };
    const markedKeys = new Set(
      (att ?? []).map(
        (a: any) => `${a.student_id}:${a.lesson_sessions?.session_date}`
      )
    );

    const rows: Booking[] = (books ?? []).map((b: any) => ({
      id: b.id,
      session_date: b.session_date,
      student_id: b.student_id ?? "",
      student_name: b.students?.full_name ?? "—",
      class_title: b.classes?.title ?? "—",
      marked: markedKeys.has(`${b.student_id}:${b.session_date}`),
    }));
    setUpcoming(rows.filter((r) => r.session_date >= today));
    setPast(rows.filter((r) => r.session_date < today && !r.marked));

    // Eligible: active child with an active enrolment. The RPC re-checks all
    // of this — the list is an affordance, not the guard (§7.32).
    setEligible(
      (kids ?? [])
        .filter((k: any) => k.is_active)
        .map((k: any) => {
          const enrolled = (k.student_class_enrolments ?? [])
            .filter((e: any) => e.is_active && e.classes)
            .map((e: any) => ({
              id: e.classes.id,
              title: e.classes.title,
              category_id: e.classes.category_id,
            }));
          if (enrolled.length === 0) return null;
          return {
            id: k.id,
            full_name: k.full_name,
            home_classes: enrolled,
          };
        })
        .filter(Boolean) as EligibleKid[]
    );

    // The expiry advisory's inputs — both fire-and-forget: without them the
    // warning simply doesn't show, and the booking still works.
    const kidIds = (kids ?? []).map((k: any) => k.id);
    if (kidIds.length) {
      supabase
        .from("parent_students")
        .select("parent_id, student_id")
        .in("student_id", kidIds)
        .then(({ data }) => {
          const m = new Map<string, string[]>();
          for (const r of data ?? []) {
            const list = m.get(r.student_id as string) ?? [];
            list.push(r.parent_id as string);
            m.set(r.student_id as string, list);
          }
          setParentsOf(m);
        });
    }
    supabase.rpc("package_live_balances").then(({ data }) => {
      const today2 = todayInSg();
      setLivePackages(
        ((data ?? []) as any[])
          .filter((p) => String(p.expires_on ?? "") >= today2)
          .map((p) => ({
            parent_id: p.parent_id,
            category_id: p.category_id ?? null,
            expires_on: String(p.expires_on),
            live_lessons_remaining: Number(p.live_lessons_remaining ?? 0),
          }))
      );
    });

    setLoading(false);
  }

  const kid = eligible.find((k) => k.id === bookKid);

  // WHICH class this make-up replaces. Auto-selected when there is only one, so
  // the single-class case is unchanged; asked when there is a choice.
  const homeClass =
    kid?.home_classes.find((c) => c.id === bookHome) ??
    (kid?.home_classes.length === 1 ? kid.home_classes[0] : undefined);

  // Same-category classes, minus EVERY class the child is in.
  //
  // ⚠ THE EXCLUSION IS "ALL THEIR CLASSES", NOT "THE HOME CLASS". Excluding only
  // the chosen home would leave the child's OTHER class in this list — and it is
  // the likeliest pick, since the list is already filtered to their category.
  // Booking that is not a billing bug (enrolment-wins prices it correctly as a
  // member) but it SILENTLY VOIDS the make-up: the child attends the lesson they
  // were already attending. book_makeup() refuses it; this keeps it off screen.
  // Category comes from the CHOSEN home class, so switching home re-filters.
  const hostChoices = useMemo(() => {
    if (!kid || !homeClass) return [];
    const ownIds = new Set(kid.home_classes.map((c) => c.id));
    return classes.filter(
      (c) => c.category_id === homeClass.category_id && !ownIds.has(c.id)
    );
  }, [classes, kid, homeClass]);

  /** Real lesson dates for the host class: its weekday pattern (a short look
   *  back, a couple of months ahead) PLUS any admin-scheduled off-schedule
   *  session — book_makeup() accepts those too. Affordance, not the guard. */
  function datesFor(classId: string): string[] {
    const c = classes.find((x) => x.id === classId);
    if (!c) return [];
    const today = todayInSg();
    const shift = (days: number): string => {
      const [y, m, d] = today.split("-").map(Number);
      const t = new Date(Date.UTC(y, m - 1, d + days));
      const pad = (n: number) => String(n).padStart(2, "0");
      return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`;
    };
    const pattern = expectedLessonDates(c.day_of_week, shift(-21), shift(70));
    const extras = extraDates.get(classId) ?? [];
    return [...new Set([...pattern, ...extras])].sort();
  }

  /** The advisory: if every live same-category package of this child's family
   *  expires before the chosen date, the lesson will bill at the class rate. */
  const expiryWarning = useMemo(() => {
    if (!kid || !bookDate) return null;
    const parentIds = new Set(parentsOf.get(kid.id) ?? []);
    if (parentIds.size === 0) return null;
    const familyPkgs = livePackages.filter(
      (p) =>
        parentIds.has(p.parent_id) &&
        (p.category_id === null || p.category_id === homeClass?.category_id)
    );
    if (familyPkgs.length === 0) return null;
    const covering = familyPkgs.some((p) => p.expires_on >= bookDate);
    if (covering) return null;
    const latest = familyPkgs.map((p) => p.expires_on).sort().at(-1)!;
    return `The family's package expires ${formatSgDate(latest)} — this lesson is after that, so it will bill at the class rate instead.`;
  }, [kid, bookDate, parentsOf, livePackages]);

  // The search results, capped so a two-letter query over hundreds of
  // children doesn't render a wall. The cap is display-only — narrowing the
  // query is the intended way to find someone, and the cut is announced.
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
  const KID_RESULTS_CAP = 8;

  async function handleBook() {
    setBookError(null);
    if (!bookKid || !bookClass || !bookDate) return;
    setBookBusy(true);
    // book_makeup() holds every refusal — wrong category, own class, wrong
    // weekday, an already-billed month — and answers in plain sentences.
    // Show them as-is.
    const { error } = await supabase.rpc("book_makeup", {
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
    const { error } = await supabase.rpc("cancel_makeup_booking", {
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

  if (loading) {
    return <p className="text-sm text-gray-500">Loading…</p>;
  }

  return (
    <div>
      <PageHeader
        title="Make-ups"
        subtitle="A child joining another class for one lesson, to make up a missed one"
        action={<Button onClick={() => setBookOpen(true)}>Book a make-up</Button>}
      />

      {/* ── Past and unmarked: the half that matters ───────────────────────── */}
      {past.length > 0 && (
        <div className="mb-6 rounded-xl border border-red-200 bg-red-50 p-4">
          <p className="text-sm font-semibold text-red-700">
            {past.length} make-up{past.length === 1 ? "" : "s"} still need marking
          </p>
          <p className="mt-0.5 mb-3 text-xs text-red-700">
            These lessons have passed and the coach hasn&apos;t recorded them.
            The billing month stays open until they do — mark them in the coach
            app, or cancel the booking if the child never came.
          </p>
          <ul className="space-y-1">
            {past.map((b) => (
              <li key={b.id} className="flex items-center gap-3 text-xs text-gray-800">
                <span className="font-semibold">{b.student_name}</span>
                <span className="text-gray-500">
                  {b.class_title} · {formatSgDate(b.session_date)}
                </span>
                <button
                  onClick={() => handleCancel(b.id)}
                  className="ml-auto rounded-lg border border-gray-300 px-2 py-0.5 font-semibold text-gray-600 hover:bg-white"
                >
                  Cancel
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      <h2 className="mb-2 text-sm font-semibold text-gray-700">Upcoming</h2>
      <Table>
        <Thead>
          <Th sort={makeupSort} sortKey="student_name">Child</Th>
          <Th sort={makeupSort} sortKey="class_title">Joining</Th>
          <Th sort={makeupSort} sortKey="session_date">Date</Th>
          <Th sort={makeupSort} sortKey="marked">Status</Th>
          <Th>Actions</Th>
        </Thead>
        <Tbody>
          {upcoming.length === 0 ? (
            <Tr>
              <Td className="text-gray-400">No make-ups booked.</Td>
              <Td>{""}</Td><Td>{""}</Td><Td>{""}</Td><Td>{""}</Td>
            </Tr>
          ) : (
            visibleUpcoming.map((b) => (
              <Tr key={b.id}>
                <Td className="font-medium text-gray-800">{b.student_name}</Td>
                <Td className="text-gray-500">{b.class_title}</Td>
                <Td className="text-gray-500">{formatSgDate(b.session_date)}</Td>
                <Td className="text-gray-500">
                  {b.marked ? "Marked" : "Awaiting the lesson"}
                </Td>
                <Td>
                  <button
                    onClick={() => handleCancel(b.id)}
                    className="rounded-lg border border-gray-200 px-2.5 py-1 text-xs font-semibold text-gray-600 hover:bg-gray-50"
                  >
                    Cancel
                  </button>
                </Td>
              </Tr>
            ))
          )}
        </Tbody>
      </Table>

      <p className="mt-4 max-w-2xl text-xs text-gray-500">
        A make-up stays in the child&apos;s own kind of class — group with
        group, private with private. If the family has a prepaid package, the
        attended make-up draws from it; otherwise it bills at the child&apos;s
        own class price. To repeat a lesson with the child&apos;s <em>own</em>{" "}
        class on another day, use <strong>Extra lesson</strong> on the{" "}
        <Link href="/classes" className="font-semibold text-blue-600 hover:underline">
          Classes
        </Link>{" "}
        page instead.
      </p>

      {/* ── Book ───────────────────────────────────────────────────────────── */}
      <Modal title="Book a make-up" open={bookOpen} onClose={() => setBookOpen(false)}>
        <div className="space-y-4">
          <div>
            <span className="text-xs font-semibold text-gray-600">Child</span>
            {kid ? (
              // Chosen. One line naming child + class, and a Change control —
              // re-opening the search is how you un-pick.
              <div className="mt-1 flex items-center justify-between rounded-lg border border-sky-200 bg-sky-50 px-3 py-2">
                <span className="text-sm text-sky-900">
                  <span className="font-semibold">{kid.full_name}</span>
                  <span className="text-sky-700">
                    {" "}
                    — {kid.home_classes.map((c) => c.title).join(" · ")}
                  </span>
                </span>
                <button
                  onClick={() => {
                    setBookKid("");
                    setBookClass("");
                    setBookDate("");
                  }}
                  className="rounded-lg border border-sky-300 px-2 py-0.5 text-xs font-semibold text-sky-700 hover:bg-white"
                >
                  Change
                </button>
              </div>
            ) : (
              <>
                <input
                  type="text"
                  placeholder="Search by child or class…"
                  value={kidQuery}
                  onChange={(e) => setKidQuery(e.target.value)}
                  autoFocus
                  className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-sky-400"
                />
                <div className="mt-1 max-h-56 overflow-y-auto rounded-lg border border-gray-200 divide-y divide-gray-100">
                  {kidMatches.length === 0 ? (
                    <p className="px-3 py-2 text-xs text-gray-400">
                      No enrolled child matches “{kidQuery}”.
                    </p>
                  ) : (
                    kidMatches.slice(0, KID_RESULTS_CAP).map((k) => (
                      <button
                        key={k.id}
                        onClick={() => {
                          setBookKid(k.id);
                          setBookHome("");
                          setBookClass("");
                          setBookDate("");
                        }}
                        className="flex w-full items-baseline justify-between gap-2 px-3 py-2 text-left text-sm hover:bg-sky-50"
                      >
                        <span className="font-medium text-gray-800">
                          {k.full_name}
                        </span>
                        <span className="shrink-0 text-xs text-gray-500">
                          {k.home_classes.map((c) => c.title).join(" · ")}
                        </span>
                      </button>
                    ))
                  )}
                  {kidMatches.length > KID_RESULTS_CAP && (
                    <p className="px-3 py-1.5 text-[11px] text-gray-400">
                      {kidMatches.length - KID_RESULTS_CAP} more — keep typing to
                      narrow it down.
                    </p>
                  )}
                </div>
                <span className="mt-1 block text-[11px] text-gray-400">
                  Only children currently enrolled in a class. The search matches
                  the child&apos;s name or their class&apos;s name.
                </span>
              </>
            )}
          </div>

          {/* WHICH class this replaces. Only asked when the answer is not forced
              — a child with one class sees nothing here, exactly as before.
              book_makeup() refuses to guess for a multi-class child, and it is
              right to: the class chosen here is snapshotted onto the booking and
              prices the invoice line. */}
          {kid && kid.home_classes.length > 1 && (
            <label className="block">
              <span className="text-xs font-semibold text-gray-600">
                Which class is this making up?
              </span>
              <select
                value={bookHome}
                onChange={(e) => {
                  setBookHome(e.target.value);
                  // The host list and the package advisory are both derived from
                  // this, so a stale host choice would silently belong to the
                  // wrong category.
                  setBookClass("");
                  setBookDate("");
                }}
                className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
              >
                <option value="">Choose the class they missed…</option>
                {kid.home_classes.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.title}
                  </option>
                ))}
              </select>
            </label>
          )}

          {kid && kid.home_classes.length > 1 && !homeClass ? (
            <p className="rounded-lg border border-gray-100 bg-gray-50 px-3 py-2 text-xs text-gray-600">
              {kid.full_name} is in {kid.home_classes.length} classes. Pick the one
              they missed and the rest of the form will follow.
            </p>
          ) : kid && homeClass && hostChoices.length === 0 ? (
            // No other class in this category to guest into. Two shapes reach
            // here: the private-coach one (only one class of its kind exists),
            // and — since Wave 2 — a child who is already in EVERY class of
            // their kind. Both have the same answer.
            <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5">
              <p className="text-xs font-semibold text-amber-800">
                No other class of the same kind to join.
              </p>
              <p className="mt-1 text-xs text-amber-700">
                {kid.home_classes.length > 1
                  ? `${kid.full_name} is already in every class of this kind, so there is`
                  : `${homeClass.title} is the only class of its kind, so there is`}{" "}
                nothing to guest into. Schedule an <strong>Extra lesson</strong>{" "}
                of the child&apos;s own class instead, on the{" "}
                <Link href="/classes" className="font-semibold underline">
                  Classes
                </Link>{" "}
                page.
              </p>
            </div>
          ) : (
            <>
              <label className="block">
                <span className="text-xs font-semibold text-gray-600">
                  Class to join
                </span>
                <select
                  value={bookClass}
                  onChange={(e) => {
                    setBookClass(e.target.value);
                    setBookDate("");
                  }}
                  disabled={!bookKid}
                  className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm disabled:bg-gray-50"
                >
                  <option value="">
                    {bookKid ? "Choose a class…" : "Choose a child first"}
                  </option>
                  {hostChoices.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.title}
                    </option>
                  ))}
                </select>
                <span className="mt-1 block text-[11px] text-gray-400">
                  Only classes of the same kind as the child&apos;s own.
                </span>
              </label>

              <label className="block">
                <span className="text-xs font-semibold text-gray-600">Lesson</span>
                <select
                  value={bookDate}
                  onChange={(e) => setBookDate(e.target.value)}
                  disabled={!bookClass}
                  className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm disabled:bg-gray-50"
                >
                  <option value="">
                    {bookClass ? "Choose a date…" : "Choose a class first"}
                  </option>
                  {datesFor(bookClass).map((d) => (
                    <option key={d} value={d}>
                      {formatSgDate(d)}
                    </option>
                  ))}
                </select>
                <span className="mt-1 block text-[11px] text-gray-400">
                  The days this class runs, plus any extra lesson its admin has
                  scheduled.
                </span>
              </label>
            </>
          )}

          {expiryWarning && (
            <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
              {expiryWarning}
            </p>
          )}

          {bookError && (
            <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
              {bookError}
            </p>
          )}

          <Button
            className="w-full"
            disabled={bookBusy || !bookKid || !bookClass || !bookDate}
            onClick={handleBook}
          >
            {bookBusy ? "Booking…" : "Book the make-up"}
          </Button>
        </div>
      </Modal>
    </div>
  );
}
