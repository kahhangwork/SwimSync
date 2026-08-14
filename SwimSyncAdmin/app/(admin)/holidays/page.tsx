"use client";

import { useEffect, useRef, useState } from "react";
import { Plus, Trash2, Upload } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { PageHeader } from "@/components/PageHeader";
import { Table, Thead, Th, Tbody, Tr, Td, useTableSort } from "@/components/Table";
import { Button } from "@/components/Button";
import { Modal } from "@/components/Modal";
import { parseHolidaysCsv } from "@/lib/holidaysCsv";

type Holiday = { id: string; holiday_date: string; name: string };

const DATA_GOV_SG_URL =
  "https://data.gov.sg/datasets?query=public+holidays&resultId=d_3751791452397f1b1c80c451447e40b7";

async function myTenantId(): Promise<string | null> {
  const { data: user } = await supabase.auth.getUser();
  if (!user.user) return null;
  const { data } = await supabase
    .from("profiles")
    .select("tenant_id")
    .eq("id", user.user.id)
    .single();
  return (data?.tenant_id as string | null) ?? null;
}

export default function HolidaysPage() {
  const [holidays, setHolidays] = useState<Holiday[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Add form
  const [addModal, setAddModal] = useState(false);
  const [newDate, setNewDate] = useState("");
  const [newName, setNewName] = useState("");
  const [formError, setFormError] = useState<string | null>(null);

  // CSV import feedback
  const [importResult, setImportResult] = useState<{
    added: number;
    errors: string[];
  } | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    load();
  }, []);

  // A holiday change must re-extend this business's packages immediately, so an
  // admin who imports holidays and then bills does not strand tail lessons on
  // the ad-hoc path (⚠ #1). Idempotent and best-effort.
  async function recomputeExtensions() {
    const tenant = await myTenantId();
    if (!tenant) return;
    try {
      await supabase.rpc("recompute_package_extensions", { p_tenant: tenant });
    } catch {
      /* best-effort — the nightly / on-load recompute is the backstop */
    }
  }

  async function load() {
    setLoading(true);
    const { data } = await supabase
      .from("tenant_public_holidays")
      .select("id, holiday_date, name")
      .order("holiday_date");
    setHolidays((data ?? []) as Holiday[]);
    setLoading(false);
  }

  async function addHoliday() {
    if (!newDate) return setFormError("Pick a date.");
    if (!newName.trim()) return setFormError("Give the holiday a name.");
    setBusy(true);
    setFormError(null);
    const tenant_id = await myTenantId();
    // Pass the date string straight through — never a re-formatted Date (§7.7).
    const { error: err } = await supabase
      .from("tenant_public_holidays")
      .insert({ tenant_id, holiday_date: newDate, name: newName.trim() });
    setBusy(false);
    if (err) {
      setFormError(
        err.code === "23505"
          ? "You already have a holiday on that date."
          : "Could not add that holiday."
      );
      return;
    }
    setAddModal(false);
    setNewDate("");
    setNewName("");
    await recomputeExtensions();
    load();
  }

  async function removeHoliday(h: Holiday) {
    setBusy(true);
    const { error: err } = await supabase
      .from("tenant_public_holidays")
      .delete()
      .eq("id", h.id);
    setBusy(false);
    if (err) setError("Could not remove that holiday.");
    await recomputeExtensions();
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
      const { error: err, count } = await supabase
        .from("tenant_public_holidays")
        .upsert(
          rows.map((r) => ({
            tenant_id,
            holiday_date: r.date,
            name: r.name,
          })),
          { onConflict: "tenant_id,holiday_date", count: "exact" }
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
    await recomputeExtensions();
    load();
  }

  const sort = useTableSort<Holiday>({ key: "holiday_date" });
  const visible = sort.apply(holidays);

  return (
    <div>
      <PageHeader
        title="Holidays"
        subtitle={`${holidays.length} public holiday${
          holidays.length === 1 ? "" : "s"
        } — packages auto-extend a week for each one a lesson falls on`}
        action={
          <div className="flex gap-2">
            <input
              ref={fileInput}
              type="file"
              accept=".csv,text/csv"
              className="hidden"
              onChange={onCsvChosen}
            />
            <Button
              variant="outline"
              onClick={() => fileInput.current?.click()}
              disabled={busy}
            >
              <Upload className="h-4 w-4" />
              Import CSV
            </Button>
            <Button
              onClick={() => {
                setNewDate("");
                setNewName("");
                setFormError(null);
                setAddModal(true);
              }}
            >
              <Plus className="h-4 w-4" />
              Add holiday
            </Button>
          </div>
        }
      />

      <p className="mb-4 text-sm text-gray-500">
        Import Singapore&rsquo;s public holidays as a CSV from{" "}
        <a
          href={DATA_GOV_SG_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="text-sky-600 underline"
        >
          data.gov.sg
        </a>{" "}
        (columns <span className="font-mono text-xs">date, day, holiday</span>),
        or add dates by hand — including your own closures.
      </p>

      {error && (
        <p className="mb-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">
          {error}
        </p>
      )}

      {importResult && (
        <div className="mb-4 rounded-lg bg-gray-50 px-3 py-2 text-sm">
          <p className="font-medium text-gray-800">
            Imported {importResult.added} holiday
            {importResult.added === 1 ? "" : "s"}.
          </p>
          {importResult.errors.length > 0 && (
            <ul className="mt-1 list-disc pl-5 text-amber-700">
              {importResult.errors.slice(0, 8).map((msg, i) => (
                <li key={i}>{msg}</li>
              ))}
              {importResult.errors.length > 8 && (
                <li>…and {importResult.errors.length - 8} more.</li>
              )}
            </ul>
          )}
        </div>
      )}

      <Table>
        <Thead>
          <Th sort={sort} sortKey="holiday_date">Date</Th>
          <Th sort={sort} sortKey="name">Holiday</Th>
          <Th>&nbsp;</Th>
        </Thead>
        <Tbody>
          {loading ? (
            <Tr>
              <Td className="py-8 text-center text-gray-400" colSpan={3}>
                Loading…
              </Td>
            </Tr>
          ) : visible.length === 0 ? (
            <Tr>
              <Td className="py-8 text-center text-gray-400" colSpan={3}>
                No holidays yet. Import a CSV or add one.
              </Td>
            </Tr>
          ) : (
            visible.map((h) => (
              <Tr key={h.id}>
                <Td className="font-medium text-gray-900">{h.holiday_date}</Td>
                <Td className="text-gray-600">{h.name}</Td>
                <Td>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="text-red-600 hover:bg-red-50"
                    onClick={() => removeHoliday(h)}
                    disabled={busy}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                    Remove
                  </Button>
                </Td>
              </Tr>
            ))
          )}
        </Tbody>
      </Table>

      <Modal
        title="Add a holiday"
        open={addModal}
        onClose={() => setAddModal(false)}
      >
        <div className="space-y-4">
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">
              Date
            </label>
            <input
              type="date"
              value={newDate}
              onChange={(e) => setNewDate(e.target.value)}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">
              Name
            </label>
            <input
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="Chinese New Year"
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
            />
          </div>
          {formError && <p className="text-sm text-red-600">{formError}</p>}
          <div className="flex justify-end gap-2">
            <Button
              variant="outline"
              onClick={() => setAddModal(false)}
              disabled={busy}
            >
              Cancel
            </Button>
            <Button onClick={addHoliday} disabled={busy}>
              {busy ? "Adding…" : "Add holiday"}
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
