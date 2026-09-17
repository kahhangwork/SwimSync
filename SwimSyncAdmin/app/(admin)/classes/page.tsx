"use client";

import { useEffect, useMemo, useState } from "react";
import { Plus } from "lucide-react";
import { PageHeader } from "@/components/PageHeader";
import { Button } from "@/components/Button";
import { Modal } from "@/components/Modal";
import { todayInSg } from "@/lib/lessonDates";
import { CLASS_COLOURS } from "@/lib/classColours";
import { locationFilterOptions, formLocationOptions } from "@/lib/locationOptions";

import { DAYS } from "./constants";
import type { ClassRow, LocationOpt } from "./types";
// Transitional page->dao imports (playbook §7.1): until each slice's hook wraps
// these calls (Stages 5-10), the page calls the dao directly. Pinned in
// ALLOWED_PAGE_IMPORTS; both entries are gone by Stage 10.
import * as repo from "./dao/classes.repo";
import * as rpc from "./dao/classes.rpc";
import { capitalize, countActiveRetired } from "./domain/classRows";
import { useClassList } from "./domain/useClassList";
import { useRoster } from "./domain/useRoster";
import { useClassDrawer } from "./domain/useClassDrawer";
import { ClassToolbar } from "./ui/ClassToolbar";
import { ClassTable } from "./ui/ClassTable";
import { RosterDrawer } from "./ui/RosterDrawer";

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
  // The list slice (classes + the shared `coaches` spine + toolbar state).
  const list = useClassList();
  const {
    classes,
    coaches,
    loading,
    search,
    setSearch,
    capped,
    locationFilter,
    setLocationFilter,
    showRetired,
    setShowRetired,
    filtered,
  } = list;
  const loadClasses = list.load;
  const loadCoaches = list.loadCoaches;

  // The roster slice (enrolments/bookings/covMap + the one rosterByClass the
  // badge and the drawer share). Takes the class list as its input.
  const roster = useRoster(classes);
  const { covMap, rosterError, rosterByClass, loadRoster } = roster;

  // The roster drawer + shadow-coach management. Takes the shared coaches spine.
  const drawer = useClassDrawer(coaches);
  const {
    drawerClass,
    setDrawerClass,
    shadows,
    shadowPick,
    setShadowPick,
    shadowFrom,
    setShadowFrom,
    shadowBusy,
    shadowError,
    handleAssignShadow,
    handleEndShadow,
  } = drawer;

  const [showModal, setShowModal] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);

  // (The roster data lives in useRoster; the drawer selection + shadow-coach
  // state live in useClassDrawer — both destructured above.)

  // Form state
  const [title, setTitle] = useState("");
  const [coachId, setCoachId] = useState("");
  const [day, setDay] = useState("");
  const [startTime, setStartTime] = useState("");
  const [endTime, setEndTime] = useState("");
  const [locationId, setLocationId] = useState("");
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
  const [categories, setCategories] = useState<
    { id: string; name: string; default_capacity: number | null }[]
  >([]);
  const [categoryId, setCategoryId] = useState("");
  // Every location for this business, INCLUDING archived. The form picker needs
  // an archived one to represent a reactivated class's current value (RISK 6),
  // and the name lookup covers retired classes sitting on an archived location.
  const [locations, setLocations] = useState<LocationOpt[]>([]);
  // Capacity + colour are informational (calendar "x/y" count and card colour),
  // not effective-dated and not money, so they travel with category_id: the
  // same plain UPDATE beside set_class_terms, never inside it.
  const [capacity, setCapacity] = useState("");
  const [colour, setColour] = useState<string | null>(null);

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

  // ── Cancelling a lesson in advance (plan Phase B) ─────────────────────────
  // The second home for cancel_lesson() — the first is the lesson page reached
  // from the Calendar. Class + future date + reason; every refusal (today/past,
  // guests booked, already marked) is the RPC's own and is rendered verbatim.
  const [cancelFor, setCancelFor] = useState<ClassRow | null>(null);
  const [cancelDate, setCancelDate] = useState("");
  const [cancelReason, setCancelReason] = useState("");
  const [cancelSaving, setCancelSaving] = useState(false);
  const [cancelError, setCancelError] = useState<string | null>(null);
  const [cancelDone, setCancelDone] = useState<string | null>(null);

  // ── Retiring a class ──────────────────────────────────────────────────────
  // (showRetired is a list-toolbar filter and lives in useClassList.)
  const [retireFor, setRetireFor] = useState<ClassRow | null>(null);
  const [retireSaving, setRetireSaving] = useState(false);
  const [restoringId, setRestoringId] = useState<string | null>(null);
  const [retireError, setRetireError] = useState<string | null>(null);

  useEffect(() => {
    loadClasses();
    loadCoaches();
    loadCategories();
    loadLocations();
    loadRoster();
  }, []);

  async function loadCategories() {
    const { data } = await repo.loadCategories();
    setCategories(data ?? []);
  }

  async function loadLocations() {
    const { data } = await repo.loadLocations();
    setLocations((data ?? []) as LocationOpt[]);
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
    setLocationId("");
    setRate("");
    setCategoryId("");
    setCapacity("");
    setColour(null);
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
    setLocationId(cls.location_id);
    setRate(String(cls.price_per_lesson));
    setCategoryId(cls.category_id ?? "");
    setCapacity(cls.capacity == null ? "" : String(cls.capacity));
    setColour(cls.colour);
    setSaveError(null);
    setEditingId(cls.id);
    setShowModal(true);
  }

  async function handleSubmit() {
    if (!title || !coachId || !day || !startTime || !endTime || !locationId || !rate) {
      setSaveError("Please fill in all fields.");
      return;
    }
    // The picked location supplies the name/address the free-text columns still
    // require through the expand window (RISK 1 — send both so the two agree).
    const picked = locations.find((l) => l.id === locationId);
    if (!picked) {
      setSaveError("Please choose a location.");
      return;
    }
    // Checked separately so the message names the field. category_id is NOT
    // NULL in the database; without this the admin would get a raw constraint
    // error naming a column the form calls something else.
    if (!categoryId) {
      setSaveError("Please choose a category.");
      return;
    }
    // Empty = "use the category default"; anything else must be a whole
    // number ≥ 1 or the CHECK (capacity > 0) answers with a raw constraint name.
    const capacityValue = capacity.trim() === "" ? null : Number(capacity);
    if (capacityValue !== null && (!Number.isInteger(capacityValue) || capacityValue < 1)) {
      setSaveError("Capacity must be a whole number of 1 or more, or left blank.");
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
      // Only the FK — the DB sync trigger mirrors the free-text location_name /
      // location_address from the entity, so this insert never names the columns
      // the contract migration drops (RISK 1b, write side).
      location_id: locationId,
      price_per_lesson: parseFloat(rate),
      category_id: categoryId,
      capacity: capacityValue,
      colour,
    };

    // Editing goes through set_class_terms, never a bare UPDATE (rpc.setClassTerms
    // carries the full effective-dating reasoning + the RISK 1 required-keys type).
    // Creating a class is still a plain insert — the seed trigger gives it
    // floor-dated terms.
    const { error } = editingId
      ? await rpc.setClassTerms({
          p_class_id: editingId,
          p_title: title,
          p_day_of_week: day,
          p_start_time: startTime,
          p_end_time: endTime,
          p_location_name: picked.name,
          p_price_per_lesson: parseFloat(rate),
          p_coach_id: coachId,
          // A correction rewrites history (there was never a period at the old
          // number); a change starts a new one from today. Only asked when the
          // money actually moved — see moneyChanged. Clock read HERE, not in dao.
          p_effective_from: correctInPlace ? null : todayInSg(),
          p_correct_in_place: correctInPlace,
          p_location_address: picked.address,
          p_location_id: locationId,
        })
      : await repo.insertClass({ ...payload, is_active: true });

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
      // ONE statement for all three non-terms fields: one failure mode, one
      // "Saved, but…" message, no third partial-save state.
      const { error: catErr } = await repo.updateClassMeta(editingId, {
        category_id: categoryId || null,
        capacity: capacityValue,
        colour,
      });
      if (catErr) {
        setSaveError(`Saved, but the category, capacity and colour were not: ${catErr.message}`);
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
    const { error } = await rpc.scheduleExtraLesson({
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

  function openCancel(cls: ClassRow) {
    setCancelFor(cls);
    setCancelDate("");
    setCancelReason("");
    setCancelError(null);
    setCancelDone(null);
  }

  async function handleCancelLesson() {
    if (!cancelFor) return;
    setCancelSaving(true);
    setCancelError(null);
    const { error } = await rpc.cancelLesson({
      p_class_id: cancelFor.id,
      p_date: cancelDate,
      p_reason: cancelReason,
    });
    setCancelSaving(false);
    if (error) {
      setCancelError(error.message);
      return;
    }
    setCancelDone(cancelDate);
    setCancelReason("");
    setCancelDate("");
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

    const { error } = await rpc.deactivateClass({
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

    const { error } = await rpc.reactivateClass({
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

  // (The list filter + clamp now live in useClassList / domain/classRows.)
  // Both location derivations are pure and unit-tested in lib/locationOptions.ts.
  const locationOptions = useMemo(() => locationFilterOptions(classes), [classes]);
  const pickerOptions = useMemo(
    () => formLocationOptions(locations, locationId),
    [locations, locationId]
  );

  const openRoster = rosterByClass.get(drawerClass?.id ?? "") ?? {
    enrolled: [],
    trials: [],
  };

  const { active: activeCount, retired: retiredCount } = countActiveRetired(classes);

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

      <ClassToolbar
        search={search}
        onSearch={setSearch}
        locationOptions={locationOptions}
        locationFilter={locationFilter}
        onLocationFilter={setLocationFilter}
        showRetired={showRetired}
        onShowRetired={setShowRetired}
        retiredCount={retiredCount}
        loading={loading}
        capped={capped}
        retireError={retireError}
        retireFor={retireFor}
      />

      <ClassTable
        filtered={filtered}
        loading={loading}
        rosterByClass={rosterByClass}
        restoringId={restoringId}
        onSeeStudents={setDrawerClass}
        onEdit={openEdit}
        onExtra={openExtra}
        onCancel={openCancel}
        onRetire={(cls) => {
          setRetireError(null);
          setRetireFor(cls);
        }}
        onRestore={handleRestore}
      />

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

      {/* Cancel a lesson in advance */}
      <Modal
        title={cancelFor ? `Cancel a lesson — ${cancelFor.title}` : "Cancel a lesson"}
        open={cancelFor !== null}
        onClose={() => setCancelFor(null)}
      >
        <div className="space-y-4">
          <p className="text-sm text-gray-500">
            Call off ONE upcoming lesson of this class — rain, the coach away.
            Parents see it struck out under Upcoming with your reason, the coach
            has nothing to mark, and the billing month does not wait for it.{" "}
            <span className="text-gray-700">A lesson that already happened</span>{" "}
            is recorded by the coach as cancelled (rain / coach) instead.
          </p>

          <Field
            label="Date"
            placeholder=""
            value={cancelDate}
            onChange={setCancelDate}
            type="date"
          />

          <Field
            label="Reason"
            value={cancelReason}
            onChange={setCancelReason}
            placeholder="e.g. Heavy rain forecast — pool closed"
          />
          <p className="-mt-2 text-xs text-gray-400">
            Shown to every parent in the class and to the coach.
          </p>

          {cancelError && (
            <p data-testid="cancel-error" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
              {cancelError}
            </p>
          )}

          {cancelDone && (
            <p data-testid="cancel-done" className="rounded-lg bg-green-50 px-3 py-2 text-sm text-green-700">
              Cancelled for {cancelDone}. Open the lesson from the Calendar to restore it.
            </p>
          )}

          <div className="flex gap-2">
            <Button variant="outline" className="flex-1" onClick={() => setCancelFor(null)}>
              Close
            </Button>
            <Button
              className="flex-1"
              data-testid="confirm-cancel-lesson"
              onClick={handleCancelLesson}
              disabled={cancelSaving || !cancelDate || cancelReason.trim() === ""}
            >
              {cancelSaving ? "Cancelling…" : "Cancel the lesson"}
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

      <RosterDrawer
        drawerClass={drawerClass}
        onClose={() => setDrawerClass(null)}
        rosterError={rosterError}
        shadows={shadows}
        shadowError={shadowError}
        shadowBusy={shadowBusy}
        shadowPick={shadowPick}
        onShadowPick={setShadowPick}
        shadowFrom={shadowFrom}
        onShadowFrom={setShadowFrom}
        onAssignShadow={handleAssignShadow}
        onEndShadow={handleEndShadow}
        coaches={coaches}
        openRoster={openRoster}
        covMap={covMap}
      />

      {/* Create / Edit Class Modal */}
      <Modal
        title={editingId ? "Edit Class" : "Create New Class"}
        open={showModal}
        onClose={() => setShowModal(false)}
        size="lg"
      >
        <div className="space-y-4">
          <Field
            label="Class Name"
            placeholder="e.g. Saturday Beginners"
            value={title}
            onChange={setTitle}
          />

          <div className="grid grid-cols-2 gap-3">
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

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">
                Location <span className="text-red-500">*</span>
              </label>
              <select
                value={locationId}
                onChange={(e) => setLocationId(e.target.value)}
                className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-sky-400"
              >
                <option value="">Choose a location…</option>
                {pickerOptions.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.name}
                    {l.archived_at ? " (archived)" : ""}
                  </option>
                ))}
              </select>
              <p className="mt-1 text-xs text-gray-500">
                Manage the list on the{" "}
                <a href="/locations" className="text-sky-600 hover:underline">
                  Locations
                </a>{" "}
                page.
              </p>
            </div>
            <Field
              label="Rate per Lesson (S$)"
              placeholder="40"
              type="number"
              value={rate}
              onChange={setRate}
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">
                Max students
              </label>
              <input
                type="number"
                min={1}
                step={1}
                placeholder={
                  categories.find((c) => c.id === categoryId)?.default_capacity
                    ?.toString() ?? "No limit"
                }
                value={capacity}
                onChange={(e) => setCapacity(e.target.value)}
                className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-sky-400"
              />
              <p className="mt-1 text-xs text-gray-500">
                Blank = the category&apos;s default. Shown on the calendar as
                &ldquo;students / max&rdquo;; nothing is refused on it.
              </p>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">
                Calendar colour
              </label>
              <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="Calendar colour">
                <button
                  type="button"
                  role="radio"
                  aria-checked={colour === null}
                  title="No colour"
                  onClick={() => setColour(null)}
                  className={`h-7 w-7 rounded-full border border-gray-300 bg-white text-[10px] text-gray-500 ${
                    colour === null ? "ring-2 ring-offset-1 ring-gray-400" : ""
                  }`}
                >
                  —
                </button>
                {CLASS_COLOURS.map((c) => (
                  <button
                    key={c.key}
                    type="button"
                    role="radio"
                    aria-checked={colour === c.key}
                    aria-label={c.label}
                    title={c.label}
                    onClick={() => setColour(c.key)}
                    className={`h-7 w-7 rounded-full ${c.dot} ${
                      colour === c.key ? `ring-2 ring-offset-1 ${c.ring}` : ""
                    }`}
                  />
                ))}
              </div>
            </div>
          </div>

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
