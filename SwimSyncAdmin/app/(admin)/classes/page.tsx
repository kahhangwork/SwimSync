"use client";

import { useEffect, useState } from "react";
import { Plus, Pencil } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { PageHeader } from "@/components/PageHeader";
import { Table, Thead, Th, Tbody, Tr, Td } from "@/components/Table";
import { Button } from "@/components/Button";
import { Modal } from "@/components/Modal";

type ClassRow = {
  id: string;
  title: string;
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

  // Form state
  const [title, setTitle] = useState("");
  const [coachId, setCoachId] = useState("");
  const [day, setDay] = useState("saturday");
  const [startTime, setStartTime] = useState("");
  const [endTime, setEndTime] = useState("");
  const [location, setLocation] = useState("");
  const [rate, setRate] = useState("");

  useEffect(() => {
    loadClasses();
    loadCoaches();
  }, []);

  async function loadClasses() {
    setLoading(true);
    const { data } = await supabase
      .from("classes")
      .select(
        "id, title, day_of_week, start_time, end_time, location_name, price_per_lesson, coaches(profiles(full_name)), student_class_enrolments(id, is_active)"
      )
      .eq("is_active", true)
      .order("day_of_week")
      .order("start_time");

    setClasses(
      (data ?? []).map((c: any) => ({
        id: c.id,
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

  function resetForm() {
    setTitle("");
    setCoachId("");
    setDay("saturday");
    setStartTime("");
    setEndTime("");
    setLocation("");
    setRate("");
    setSaveError(null);
  }

  async function handleCreate() {
    if (!title || !coachId || !startTime || !endTime || !location || !rate) {
      setSaveError("Please fill in all fields.");
      return;
    }
    setSaving(true);
    setSaveError(null);

    const { error } = await supabase.from("classes").insert({
      title,
      coach_id: coachId,
      day_of_week: day,
      start_time: startTime,
      end_time: endTime,
      location_name: location,
      price_per_lesson: parseFloat(rate),
      is_active: true,
    });

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
          </tr>
        </Thead>
        <Tbody>
          {loading ? (
            <Tr>
              <Td className="text-center text-gray-400 py-8" colSpan={7}>
                Loading…
              </Td>
            </Tr>
          ) : filtered.length === 0 ? (
            <Tr>
              <Td className="text-center text-gray-400 py-8" colSpan={7}>
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
              </Tr>
            ))
          )}
        </Tbody>
      </Table>

      {/* Create Class Modal */}
      <Modal
        title="Create New Class"
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
              onClick={handleCreate}
            >
              {saving ? "Creating…" : "Create Class"}
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
