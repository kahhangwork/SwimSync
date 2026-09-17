import { Modal } from "@/components/Modal";
import { Button } from "@/components/Button";
import { CLASS_COLOURS } from "@/lib/classColours";
import { Field } from "./Field";
import { DAYS } from "../constants";
import { capitalize } from "../domain/classRows";
import type { useClassForm } from "../domain/useClassForm";
import type { Coach } from "../types";

/**
 * Create / edit a class. Takes the useClassForm hook's state as one prop
 * (playbook §2) plus the shared `coaches` spine for the coach dropdown. Markup
 * verbatim; the money-moved correction/change radio is the load-bearing intent
 * split (§ moneyChanged).
 */
export function ClassFormModal({
  form,
  coaches,
}: {
  form: ReturnType<typeof useClassForm>;
  coaches: Coach[];
}) {
  const {
    showModal,
    setShowModal,
    saving,
    saveError,
    editingId,
    title,
    setTitle,
    coachId,
    setCoachId,
    day,
    setDay,
    startTime,
    setStartTime,
    endTime,
    setEndTime,
    locationId,
    setLocationId,
    rate,
    setRate,
    correctInPlace,
    setCorrectInPlace,
    categories,
    categoryId,
    setCategoryId,
    capacity,
    setCapacity,
    colour,
    setColour,
    moneyChanged,
    pickerOptions,
    handleSubmit,
  } = form;

  return (
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
  );
}
