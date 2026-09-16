import { useEffect, useRef, useState } from "react";
import { parseHolidaysCsv } from "./holidaysCsv";
import { buildVoidCounts, clampExtDays } from "./holidayRows";
import {
  deleteHoliday,
  insertHoliday,
  loadExtensionDays,
  loadHolidays,
  loadVoidedRows,
  markDayHoliday,
  myTenantId,
  saveExtensionDays,
  unmarkDayHoliday,
  upsertHolidays,
  type Holiday,
} from "../dao/holidays.repo";

// All Holidays state, loads and writes. load() re-reads after every mutation so
// the void-count column and the package-extension figure never drift.
export function useHolidays() {
  const [holidays, setHolidays] = useState<Holiday[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [tenantId, setTenantId] = useState<string | null>(null);
  const [extDays, setExtDays] = useState<number>(7);
  const [voidMsg, setVoidMsg] = useState<string | null>(null);
  // holiday_date -> how many lessons are currently voided on it (0 = not voided).
  const [voidCounts, setVoidCounts] = useState<Record<string, number>>({});

  // Add form
  const [addModal, setAddModal] = useState(false);
  const [newDate, setNewDate] = useState("");
  const [newName, setNewName] = useState("");
  const [formError, setFormError] = useState<string | null>(null);

  // CSV import feedback
  const [importResult, setImportResult] = useState<{ added: number; errors: string[] } | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    load();
  }, []);

  async function load() {
    setLoading(true);
    const tenant = await myTenantId();
    setTenantId(tenant);
    if (tenant) {
      const ext = await loadExtensionDays(tenant);
      if (ext !== null) setExtDays(ext); // null = no tenant row -> leave as-is
    }
    setHolidays(await loadHolidays());

    // How many lessons are currently voided on each date. Few holidays, few rows.
    if (tenant) {
      setVoidCounts(buildVoidCounts(await loadVoidedRows(tenant)));
    }
    setLoading(false);
  }

  // Void every lesson scheduled on a holiday. Undoing it restores the day.
  async function voidDay(h: Holiday) {
    if (!tenantId) return;
    setBusy(true);
    setVoidMsg(null);
    const { count, error: err } = await markDayHoliday(tenantId, h.holiday_date);
    setBusy(false);
    if (err) {
      setError(err || "Could not void that day.");
      return;
    }
    setVoidMsg(`Voided ${count ?? 0} lesson${count === 1 ? "" : "s"} on ${h.holiday_date}.`);
    load();
  }

  async function unvoidDay(h: Holiday) {
    if (!tenantId) return;
    setBusy(true);
    setVoidMsg(null);
    const { count, error: err } = await unmarkDayHoliday(tenantId, h.holiday_date);
    setBusy(false);
    if (err) {
      setError(err || "Could not un-void that day.");
      return;
    }
    setVoidMsg(`Restored ${count ?? 0} lesson${count === 1 ? "" : "s"} on ${h.holiday_date}.`);
    load();
  }

  // The tenant's extension length, saved on change (mirrors invoice_run_day).
  async function saveExtDays(next: number) {
    if (!tenantId) return;
    const clamped = clampExtDays(next);
    setExtDays(clamped);
    const err = await saveExtensionDays(tenantId, clamped);
    // This number decides what every future void grants.
    if (err) setError("Could not save the extension days. Please try again.");
  }

  async function addHoliday() {
    if (!newDate) return setFormError("Pick a date.");
    if (!newName.trim()) return setFormError("Give the holiday a name.");
    setBusy(true);
    setFormError(null);
    const tenant_id = await myTenantId();
    // Pass the date string straight through — never a re-formatted Date (§7.7).
    const { code, error: err } = await insertHoliday(tenant_id, newDate, newName.trim());
    setBusy(false);
    if (err) {
      setFormError(code === "23505" ? "You already have a holiday on that date." : "Could not add that holiday.");
      return;
    }
    setAddModal(false);
    setNewDate("");
    setNewName("");
    load();
  }

  async function removeHoliday(h: Holiday) {
    setBusy(true);
    const err = await deleteHoliday(h.id);
    setBusy(false);
    if (err) setError("Could not remove that holiday.");
    load();
  }

  async function onCsvChosen(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    // Reset the input so choosing the same file again re-fires onChange.
    if (fileInput.current) fileInput.current.value = "";
    if (!file) return;

    setBusy(true);
    setError(null);
    setImportResult(null);
    const text = await file.text();
    const { holidays: rows, errors } = parseHolidaysCsv(text);

    let added = 0;
    if (rows.length > 0) {
      const tenant_id = await myTenantId();
      const { count, error: err } = await upsertHolidays(
        rows.map((r) => ({ tenant_id, holiday_date: r.date, name: r.name }))
      );
      if (err) {
        setBusy(false);
        setError("Could not import that file.");
        return;
      }
      added = count ?? rows.length;
    }

    setBusy(false);
    setImportResult({ added, errors });
    load();
  }

  function openAddModal() {
    setNewDate("");
    setNewName("");
    setFormError(null);
    setAddModal(true);
  }

  return {
    holidays,
    loading,
    error,
    busy,
    extDays,
    voidMsg,
    voidCounts,
    addModal,
    newDate,
    newName,
    formError,
    importResult,
    fileInput,
    setExtDays,
    setNewDate,
    setNewName,
    setAddModal,
    saveExtDays,
    voidDay,
    unvoidDay,
    addHoliday,
    removeHoliday,
    onCsvChosen,
    openAddModal,
  };
}

export type HolidaysState = ReturnType<typeof useHolidays>;
