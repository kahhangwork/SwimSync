"use client";

import { useEffect, useState } from "react";
import { Plus, Pencil, CalendarPlus } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { PageHeader } from "@/components/PageHeader";
import { Table, Thead, Th, Tbody, Tr, Td } from "@/components/Table";
import { Button } from "@/components/Button";
import { Modal } from "@/components/Modal";
import { todayInSg } from "@/lib/lessonDates";

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
};

type Coach = { id: string; full_name: string };

const DAYS = [
  "monday","tuesday","wednesday","thursday","friday","saturday","sunday",
];

function formatTime(t: string): string {
  const [h, m] = t.split(":");
  const hour = parseInt(h, 10);
  return `${hour % 12 || 12}:${m} ${hour >= 12 ? "PM" : "AM"}`;
}

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

  useEffect(() => {
    loadClasses();
    loadCoaches();
    loadCategories();
  }, []);

  async function loadCategories() {
    const { data } = await supabase
      .from("class_categories")
      .select("id, name")
      .order("name");
    setCategories(data ?? []);
  }

  async function loadClasses() {
    setLoading(true);
    const { data } = await supabase
      .from("classes")
      .select(
        "id, coach_id, title, day_of_week, start_time, end_time, location_name, price_per_lesson, category_id, coaches(profiles(full_name)), student_class_enrolments(id, is_active)"
      )
      .eq("is_active", true)
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
      }))
    );
    setLoading(false);
  }

  async function loadCoaches() {
    const { data } = await supabase
      .from("coaches")
      .select("id, profiles(full_name)");
    setCoaches(
      (data ?? []).map((c: any) => ({
        id: c.id,
        full_name: c.profiles?.full_name ?? "Unknown",
      }))
    );
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

  const filtered = classes.filter(
    (c) =>
      c.title.toLowerCase().includes(search.toLowerCase()) ||
      c.coach_name.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div>
      <PageHeader
        title="Classes"
        subtitle={`${classes.length} active classes`}
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

      <div className="mb-4">
        <input
          type="text"
          placeholder="Search by class name or coach..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-full max-w-sm rounded-xl border border-gray-200 bg-white px-4 py-2.5 text-sm placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-sky-400"
        />
      </div>

      <Table>
        <Thead>
<Th>Class Name</Th>
            <Th>Coach</Th>
            <Th>Day</Th>
            <Th>Time</Th>
            <Th>Location</Th>
            <Th>Rate</Th>
            <Th>Students</Th>
            <Th>Actions</Th>
</Thead>
        <Tbody>
          {loading ? (
            <Tr>
              <Td className="text-center text-gray-400 py-8" colSpan={8}>
                Loading…
              </Td>
            </Tr>
          ) : filtered.length === 0 ? (
            <Tr>
              <Td className="text-center text-gray-400 py-8" colSpan={8}>
                No classes found.
              </Td>
            </Tr>
          ) : (
            filtered.map((cls) => (
              <Tr key={cls.id}>
                <Td className="font-medium text-gray-900">{cls.title}</Td>
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
                  <span className="inline-flex items-center justify-center rounded-full bg-sky-50 px-2.5 py-0.5 text-xs font-semibold text-sky-700">
                    {cls.student_count}
                  </span>
                </Td>
                <Td>
                  <div className="flex items-center gap-1.5">
                    <button
                      onClick={() => openEdit(cls)}
                      className="inline-flex items-center gap-1 rounded-lg border border-gray-200 px-2.5 py-1 text-xs font-medium text-gray-600 hover:bg-gray-50"
                    >
                      <Pencil className="h-3.5 w-3.5" />
                      Edit
                    </button>
                    <button
                      onClick={() => openExtra(cls)}
                      className="inline-flex items-center gap-1 rounded-lg border border-gray-200 px-2.5 py-1 text-xs font-medium text-gray-600 hover:bg-gray-50"
                      title="Schedule a lesson on a day this class does not normally run"
                    >
                      <CalendarPlus className="h-3.5 w-3.5" />
                      Extra lesson
                    </button>
                  </div>
                </Td>
              </Tr>
            ))
          )}
        </Tbody>
      </Table>

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
