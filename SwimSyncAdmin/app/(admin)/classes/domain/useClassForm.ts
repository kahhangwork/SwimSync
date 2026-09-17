import { useMemo, useState } from "react";
import { todayInSg } from "@/lib/lessonDates";
import { formLocationOptions } from "./locationOptions";
import * as repo from "../dao/classes.repo";
import * as rpc from "../dao/classes.rpc";
import type { ClassRow, LocationOpt } from "../types";

/**
 * The create/edit class form. Takes the list's `load` so a save is proven by a
 * reload. Owns the form fields, the category/location option loads, and the
 * two-write submit (set_class_terms for the money terms + a plain UPDATE for the
 * SCOPE fields). ⚠ RISK 1: the money path goes through rpc.setClassTerms's
 * required-keys type, and the clock (p_effective_from) is read HERE, not in dao.
 */
export function useClassForm(load: () => Promise<void>) {
  const [showModal, setShowModal] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);

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

  function openNew() {
    resetForm();
    setShowModal(true);
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
    load();
  }

  // The form's location picker options (archived labelled, current value kept).
  const pickerOptions = useMemo(
    () => formLocationOptions(locations, locationId),
    [locations, locationId]
  );

  return {
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
    loadCategories,
    loadLocations,
    openNew,
    openEdit,
    handleSubmit,
  };
}
