"use client";

import { useEffect, useState } from "react";
import { Plus, Pencil } from "lucide-react";
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

  useEffect(() => {
    loadClasses();
    loadCoaches();
  }, []);

  async function loadClasses() {
    setLoading(true);
    const { data } = await supabase
      .from("classes")
      .select(
        "id, coach_id, title, day_of_week, start_time, end_time, location_name, price_per_lesson, coaches(profiles(full_name)), student_class_enrolments(id, is_active)"
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
    setSaveError(null);
    setEditingId(cls.id);
    setShowModal(true);
  }

  async function handleSubmit() {
    if (!title || !coachId || !day || !startTime || !endTime || !location || !rate) {
      setSaveError("Please fill in all fields.");
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

    setSaving(false);
    setShowModal(false);
    resetForm();
    loadClasses();
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
          <tr>
            <Th>Class Name</Th>
            <Th>Coach</Th>
            <Th>Day</Th>
            <Th>Time</Th>
            <Th>Location</Th>
            <Th>Rate</Th>
            <Th>Students</Th>
            <Th>Actions</Th>
          </tr>
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
                  <button
                    onClick={() => openEdit(cls)}
                    className="inline-flex items-center gap-1 rounded-lg border border-gray-200 px-2.5 py-1 text-xs font-medium text-gray-600 hover:bg-gray-50"
                  >
                    <Pencil className="h-3.5 w-3.5" />
                    Edit
                  </button>
                </Td>
              </Tr>
            ))
          )}
        </Tbody>
      </Table>

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
