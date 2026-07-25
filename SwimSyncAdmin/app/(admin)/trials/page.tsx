"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { PageHeader } from "@/components/PageHeader";
import { Table, Thead, Th, Tbody, Tr, Td } from "@/components/Table";
import { Button } from "@/components/Button";
import { Modal } from "@/components/Modal";
import {
  todayInSg,
  formatSgDate,
  expectedLessonDates,
  type DayOfWeek,
} from "@/lib/lessonDates";

/**
 * Trials — booking a child into ONE lesson, and what a trial costs.
 *
 * A trial is NOT an enrolment and NOT attendance. Booking says only "this child
 * is expected at this lesson"; the coach then marks them like anyone else, and
 * the status they choose decides what the family is charged.
 *
 * WHY THIS PAGE EXISTS AT ALL rather than a button tucked onto Students: a
 * booking you cannot see is a booking you forget, and a forgotten one now HOLDS
 * THE BILLING MONTH OPEN. The "Past — needs marking" list is the important half
 * of this screen.
 */

type Booking = {
  id: string;
  session_date: string;
  student_name: string;
  class_title: string;
  marked: boolean;
};

type ClassRow = { id: string; title: string; day_of_week: DayOfWeek };
type Category = { id: string; name: string; rate: number | null };

export default function TrialsPage() {
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

  useEffect(() => {
    loadAll();
  }, []);

  async function loadAll() {
    setLoading(true);
    const { data: auth } = await supabase.auth.getUser();
    const { data: profile } = await supabase
      .from("profiles")
      .select("tenant_id")
      .eq("id", auth.user?.id ?? "")
      .maybeSingle();
    const tid = (profile?.tenant_id as string | null) ?? null;
    setTenantId(tid);

    const [{ data: cls }, { data: cats }, { data: rates }, { data: books }] =
      await Promise.all([
        supabase
          .from("classes")
          .select("id, title, day_of_week")
          .eq("is_active", true)
          .order("title"),
        supabase.from("class_categories").select("id, name").order("name"),
        supabase
          .from("trial_rates")
          .select("category_id, rate, effective_from")
          .order("effective_from", { ascending: false }),
        supabase
          .from("trial_bookings")
          .select(
            "id, session_date, student_id, students(full_name), classes(title)"
          )
          .is("cancelled_at", null)
          .order("session_date"),
      ]);

    setClasses((cls ?? []) as ClassRow[]);

    // The rate a category is on TODAY — the newest row not dated in the future.
    // Older rows still price older lessons; this display is only "what would a
    // trial booked now cost".
    const today = todayInSg();
    const current = new Map<string, number>();
    for (const r of rates ?? []) {
      const cid = r.category_id as string;
      if (current.has(cid)) continue; // already have a newer one
      if (String(r.effective_from) <= today) current.set(cid, Number(r.rate));
    }
    setCategories(
      (cats ?? []).map((c: any) => ({
        id: c.id,
        name: c.name,
        rate: current.get(c.id) ?? null,
      }))
    );

    // Which bookings have been marked? A booking whose lesson has passed and
    // is NOT marked is what holds the month open, so it gets its own list.
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
      student_name: b.students?.full_name ?? "—",
      class_title: b.classes?.title ?? "—",
      marked: markedKeys.has(`${b.student_id}:${b.session_date}`),
    }));

    setUpcoming(rows.filter((r) => r.session_date >= today));
    setPast(rows.filter((r) => r.session_date < today && !r.marked));

    // Eligible children: in this business, active, and NOT currently in a class.
    const { data: kids } = await supabase
      .from("students")
      .select("id, full_name, is_active, student_class_enrolments(is_active)")
      .order("full_name");
    setEligible(
      (kids ?? [])
        .filter(
          (k: any) =>
            k.is_active &&
            !(k.student_class_enrolments ?? []).some((e: any) => e.is_active)
        )
        .map((k: any) => ({ id: k.id, full_name: k.full_name }))
    );

    setLoading(false);
  }

  /**
   * The dates this class actually runs, from today onward — plus a short look
   * back, so a trial that already happened can be recorded.
   *
   * Offering only real lesson dates is an affordance, NOT the guard: book_trial()
   * refuses a non-class day itself. A limit only the admin screen applies is not
   * a limit (§7.32).
   */
  function datesFor(classId: string): string[] {
    const c = classes.find((x) => x.id === classId);
    if (!c) return [];
    const today = todayInSg();
    // Date arithmetic on a YYYY-MM-DD string, via Date.UTC so no local timezone
    // is ever consulted. NOT `new Date(x).toISOString().slice(0,10)`: that is
    // the banned pattern (§7.7) and the audit grep flags it on sight, even where
    // it happens to round-trip.
    const shift = (days: number): string => {
      const [y, m, d] = today.split("-").map(Number);
      const t = new Date(Date.UTC(y, m - 1, d + days));
      const pad = (n: number) => String(n).padStart(2, "0");
      return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`;
    };
    return expectedLessonDates(c.day_of_week, shift(-21), shift(70));
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
      ? await supabase.rpc("book_trial", {
          p_class_id: bookClass,
          p_session_date: bookDate,
          p_student_id: bookExisting,
        })
      : await supabase.rpc("add_unclaimed_student", {
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
    const { error } = await supabase.rpc("cancel_trial_booking", {
      p_booking_id: id,
    });
    if (!error) await loadAll();
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
    const { data: auth } = await supabase.auth.getUser();
    // A new effective-dated ROW, never an update. Changing the price must not
    // re-value trials already taught (§7.3).
    const { error } = await supabase.from("trial_rates").insert({
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

  if (loading) {
    return <p className="text-sm text-gray-500">Loading…</p>;
  }

  return (
    <div>
      <PageHeader
        title="Trials"
        subtitle="A child trying one lesson, before they join a class"
        action={<Button onClick={() => setBookOpen(true)}>Book a trial</Button>}
      />

      {/* ── The reminder ───────────────────────────────────────────────────
          Shown while any category has no trial price, gone when they all do.
          No dismiss control and no "seen" flag: the data IS the state, so it
          cannot get out of sync, and it correctly returns if a new category is
          added later and left unpriced. */}
      {unpriced.length > 0 && (
        <div className="mb-5 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3">
          <p className="text-sm font-semibold text-amber-800">
            Set a price for {unpriced.length === 1 ? "this class type" : "these class types"}:{" "}
            {unpriced.map((c) => c.name).join(", ")}
          </p>
          <p className="mt-1 text-xs text-amber-700">
            Until you do, a paid trial of those classes is charged at the
            class&apos;s own lesson price. Nothing is blocked — but it is
            probably not what you want to charge someone trying you out.
          </p>
        </div>
      )}

      {/* ── Past and unmarked: the half that matters ───────────────────────── */}
      {past.length > 0 && (
        <div className="mb-6 rounded-xl border border-red-200 bg-red-50 p-4">
          <p className="text-sm font-semibold text-red-700">
            {past.length} trial{past.length === 1 ? "" : "s"} still need marking
          </p>
          <p className="mt-0.5 mb-3 text-xs text-red-700">
            These lessons have passed and the coach hasn&apos;t recorded them.
            The billing month stays open until they do — mark them in the coach
            app, or cancel the booking if the trial never happened.
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
          <Th>Child</Th>
          <Th>Class</Th>
          <Th>Date</Th>
          <Th>Status</Th>
          <Th>Actions</Th>
        </Thead>
        <Tbody>
          {upcoming.length === 0 ? (
            <Tr>
              <Td className="text-gray-400">No trials booked.</Td>
              <Td>{""}</Td><Td>{""}</Td><Td>{""}</Td><Td>{""}</Td>
            </Tr>
          ) : (
            upcoming.map((b) => (
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

      {/* ── Trial prices ───────────────────────────────────────────────────── */}
      <h2 className="mt-8 mb-2 text-sm font-semibold text-gray-700">
        Trial prices
      </h2>
      <p className="mb-3 max-w-2xl text-xs text-gray-500">
        What a <strong>paid</strong> trial of each kind of class costs. A free
        trial is free — the coach marks it as one, and nothing is charged.
        Changing a price applies from today onward and never re-values a lesson
        already taught.
      </p>
      <Table>
        <Thead>
          <Th>Class type</Th>
          <Th>Trial price now</Th>
          <Th>Change it</Th>
        </Thead>
        <Tbody>
          {categories.map((c) => (
            <Tr key={c.id}>
              <Td className="font-medium text-gray-800">{c.name}</Td>
              <Td className={c.rate === null ? "text-amber-600" : "text-gray-600"}>
                {c.rate === null ? "Not set — uses the class price" : `S$${c.rate.toFixed(2)}`}
              </Td>
              <Td>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-gray-500">S$</span>
                  <input
                    value={rateDraft[c.id] ?? ""}
                    onChange={(e) =>
                      setRateDraft((p) => ({ ...p, [c.id]: e.target.value }))
                    }
                    inputMode="decimal"
                    placeholder="0.00"
                    aria-label={`New trial price for ${c.name}`}
                    className="w-20 rounded-lg border border-gray-300 px-2 py-1.5 text-xs"
                  />
                  <Button
                    variant="outline"
                    disabled={rateBusy === c.id || !(Number(rateDraft[c.id]) > 0)}
                    onClick={() => handleSaveRate(c.id)}
                  >
                    Save
                  </Button>
                </div>
              </Td>
            </Tr>
          ))}
        </Tbody>
      </Table>
      {rateError && (
        <p className="mt-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
          {rateError}
        </p>
      )}

      {/* ── Book ───────────────────────────────────────────────────────────── */}
      <Modal title="Book a trial" open={bookOpen} onClose={() => setBookOpen(false)}>
        <div className="space-y-4">
          <label className="block">
            <span className="text-xs font-semibold text-gray-600">Class</span>
            <select
              value={bookClass}
              onChange={(e) => {
                setBookClass(e.target.value);
                setBookDate("");
              }}
              className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
            >
              <option value="">Choose a class…</option>
              {classes.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.title}
                </option>
              ))}
            </select>
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
              Only the days this class actually runs.
            </span>
          </label>

          <div className="rounded-lg border border-gray-200 p-3">
            <p className="mb-2 text-xs font-semibold text-gray-600">Who is trying?</p>
            {eligible.length > 0 && (
              <label className="block mb-2">
                <span className="text-[11px] text-gray-500">
                  A child already in SwimSync
                </span>
                <select
                  value={bookExisting}
                  onChange={(e) => setBookExisting(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
                >
                  <option value="">— someone new —</option>
                  {eligible.map((k) => (
                    <option key={k.id} value={k.id}>
                      {k.full_name}
                    </option>
                  ))}
                </select>
                <span className="mt-1 block text-[11px] text-gray-400">
                  Only children who aren&apos;t currently in a class.
                </span>
              </label>
            )}

            {!bookExisting && (
              <>
                <input
                  value={bookName}
                  onChange={(e) => setBookName(e.target.value)}
                  placeholder="Child's name"
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
                />
                <div className="mt-2 grid grid-cols-2 gap-2">
                  <input
                    value={bookPhone}
                    onChange={(e) => setBookPhone(e.target.value)}
                    placeholder="Parent's phone *"
                    className="rounded-lg border border-gray-300 px-3 py-2 text-sm"
                  />
                  <input
                    value={bookEmail}
                    onChange={(e) => setBookEmail(e.target.value)}
                    placeholder="Parent's email (optional)"
                    type="email"
                    className="rounded-lg border border-gray-300 px-3 py-2 text-sm"
                  />
                </div>
                <p className="mt-1 text-[11px] text-gray-400">
                  The phone is required: it is how this child is matched to
                  their parent&apos;s account later, because names get written
                  many different ways. The email is optional — it makes that
                  match certain, and it is where an invite goes if they join.
                </p>
              </>
            )}
          </div>

          {bookError && (
            <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
              {bookError}
            </p>
          )}

          <Button
            className="w-full"
            disabled={bookBusy || !bookClass || !bookDate}
            onClick={handleBook}
          >
            {bookBusy ? "Booking…" : "Book the trial"}
          </Button>
        </div>
      </Modal>
    </div>
  );
}
