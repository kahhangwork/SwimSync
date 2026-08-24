"use client";

// This business's swim-school locations.
//
// Replaces the free-text location that used to live on every class. A location
// is now an ENTITY (name, address, notes) the admin manages here, and each class
// points at one — so the list is picked from, filtered by, and shown to parents
// consistently, instead of a typo becoming a new "location".
//
// DELETE MEANS ARCHIVE. A location an ACTIVE class still uses cannot be removed
// (the database refuses it — this page's pre-check is only a friendlier
// message). Removing one that only RETIRED classes hold ARCHIVES it: it vanishes
// from this list and every picker, but the row is kept so those retired classes
// keep a valid location and reactivating one never breaks. The name frees up for
// reuse. See docs/plans/LOCATION_ENTITY_PLAN.md.

import React, { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { PageHeader } from "@/components/PageHeader";
import { Table, Thead, Th, Tbody, Tr, Td, useTableSort } from "@/components/Table";
import { Button } from "@/components/Button";
import { Modal } from "@/components/Modal";

type Location = {
  id: string;
  name: string;
  address: string | null;
  notes: string | null;
  sort_order: number;
  /** Classes still ACTIVE at this location — what blocks removal. */
  active_class_count: number;
  /** Classes RETIRED here — shown so "used by 0" is honest when departed
   *  classes still hold it, and so removal reads as archive not erase. */
  retired_class_count: number;
};

export default function LocationsPage() {
  const [locations, setLocations] = useState<Location[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<Location | null>(null);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [address, setAddress] = useState("");
  const [notes, setNotes] = useState("");
  const [sortOrder, setSortOrder] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [removing, setRemoving] = useState<Location | null>(null);

  useEffect(() => {
    load();
  }, []);

  async function load() {
    setLoading(true);
    // RLS scopes this to the caller's own business. Archived locations are
    // excluded — "delete" is archive, and an archived one is gone from the list.
    const { data } = await supabase
      .from("locations")
      .select("id, name, address, notes, sort_order, classes(id, is_active)")
      .is("archived_at", null)
      .order("sort_order")
      .order("name");

    setLocations(
      (data ?? []).map((l: any) => ({
        id: l.id,
        name: l.name,
        address: l.address,
        notes: l.notes,
        sort_order: l.sort_order,
        active_class_count: (l.classes ?? []).filter((c: any) => c.is_active).length,
        retired_class_count: (l.classes ?? []).filter((c: any) => !c.is_active).length,
      }))
    );
    setLoading(false);
  }

  function openCreate() {
    setEditing(null);
    setCreating(true);
    setName("");
    setAddress("");
    setNotes("");
    setSortOrder(String((locations.at(-1)?.sort_order ?? 0) + 1));
    setError(null);
  }

  function openEdit(l: Location) {
    setCreating(false);
    setEditing(l);
    setName(l.name);
    setAddress(l.address ?? "");
    setNotes(l.notes ?? "");
    setSortOrder(String(l.sort_order));
    setError(null);
  }

  function close() {
    setCreating(false);
    setEditing(null);
    setError(null);
  }

  async function save() {
    const trimmed = name.trim();
    if (!trimmed) {
      setError("A location needs a name.");
      return;
    }
    // Check for empty BEFORE coercing: Number("") is 0, which has silently
    // saved a $0 wage rate and a run day of 1 elsewhere in this codebase.
    if (sortOrder.trim() === "" || !Number.isFinite(Number(sortOrder))) {
      setError("Order must be a number.");
      return;
    }

    setBusy(true);
    setError(null);
    const payload = {
      name: trimmed,
      address: address.trim() || null,
      notes: notes.trim() || null,
      sort_order: Number(sortOrder),
      updated_at: new Date().toISOString(),
    };

    const { error: err } = editing
      ? await supabase.from("locations").update(payload).eq("id", editing.id)
      : await supabase.from("locations").insert({
          ...payload,
          // The caller's own business — RLS refuses any other value, and this is
          // what satisfies the WITH CHECK in the first place (the /levels shape).
          tenant_id: (
            await supabase
              .from("profiles")
              .select("tenant_id")
              .eq("id", (await supabase.auth.getUser()).data.user?.id)
              .single()
          ).data?.tenant_id,
        });

    setBusy(false);

    if (err) {
      setError(
        err.code === "23505"
          ? `You already have a location called "${trimmed}".`
          : "Could not save. Please try again."
      );
      return;
    }
    close();
    load();
  }

  // "Delete" = archive. The pre-check gives a friendly message; the database
  // trigger is the real guard (a location an active class uses cannot be
  // archived), so a raced UPDATE cannot slip past.
  async function remove(l: Location) {
    if (l.active_class_count > 0) {
      setError(
        `"${l.name}" is still used by ${l.active_class_count} active class${
          l.active_class_count === 1 ? "" : "es"
        }. Move or retire those classes first.`
      );
      setRemoving(null);
      return;
    }
    setBusy(true);
    const { error: err } = await supabase
      .from("locations")
      .update({ archived_at: new Date().toISOString() })
      .eq("id", l.id);
    setBusy(false);
    setRemoving(null);
    if (err) {
      setError(
        err.code === "23514"
          ? `"${l.name}" is still used by an active class.`
          : "Could not remove that location."
      );
      return;
    }
    load();
  }

  const sort = useTableSort<Location>({ key: "sort_order" });
  const visible = sort.apply(locations);

  return (
    <div>
      <PageHeader
        title="Locations"
        subtitle="Your swim-school locations. Each class is set to one, on the Classes page."
      />

      <div className="mb-4">
        <Button onClick={openCreate}>Add location</Button>
      </div>

      {error && !creating && editing === null && removing === null && (
        <div className="mb-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}

      {loading ? (
        <p className="text-sm text-gray-500">Loading…</p>
      ) : locations.length === 0 ? (
        <div className="rounded-lg border border-gray-200 bg-white p-8 text-center">
          <p className="font-medium text-gray-900">No locations yet</p>
          <p className="mt-1 text-sm text-gray-500">
            Add the pools and centres you teach at. Every class is then set to one
            of them, and parents see where their child&rsquo;s class is held.
          </p>
        </div>
      ) : (
        <Table>
          {/* No <Tr> here — Thead emits its own (components/Table.test.tsx). */}
          <Thead>
            <Th sort={sort} sortKey="sort_order">Order</Th>
            <Th sort={sort} sortKey="name">Location</Th>
            <Th sort={sort} sortKey="active_class_count">Classes</Th>
            <Th>Actions</Th>
          </Thead>
          <Tbody>
            {visible.map((l) => (
              <Tr key={l.id}>
                <Td className="text-gray-500">{l.sort_order}</Td>
                <Td className="font-medium text-gray-900">
                  {l.name}
                  {l.address && (
                    <div className="mt-0.5 text-xs font-normal text-gray-500">
                      {l.address}
                    </div>
                  )}
                  {l.notes && (
                    <div className="mt-0.5 text-xs font-normal italic text-gray-500">
                      {l.notes}
                    </div>
                  )}
                </Td>
                <Td className="text-gray-500">
                  <span
                    title={
                      l.retired_class_count > 0
                        ? `${l.active_class_count} active. ${l.retired_class_count} retired class${
                            l.retired_class_count === 1 ? "" : "es"
                          } still here.`
                        : undefined
                    }
                  >
                    {l.active_class_count}
                  </span>
                </Td>
                <Td>
                  <div className="flex gap-2">
                    <Button variant="outline" onClick={() => openEdit(l)}>
                      Edit
                    </Button>
                    <Button variant="outline" onClick={() => setRemoving(l)}>
                      Remove
                    </Button>
                  </div>
                </Td>
              </Tr>
            ))}
          </Tbody>
        </Table>
      )}

      <Modal
        open={creating || editing !== null}
        onClose={close}
        title={editing ? "Edit location" : "Add location"}
      >
        <div className="space-y-4">
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">
              Location name
            </label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Bishan Swimming Complex"
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">
              Address <span className="font-normal text-gray-400">(optional)</span>
            </label>
            <input
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              placeholder="1 Bishan Street 14, Singapore 579767"
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
            />
            <p className="mt-1 text-xs text-gray-500">
              Shown to parents so they know where to go.
            </p>
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">
              Notes <span className="font-normal text-gray-400">(optional)</span>
            </label>
            <input
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Park at Basement 2; enter via the side gate"
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">
              Order
            </label>
            <input
              value={sortOrder}
              onChange={(e) => setSortOrder(e.target.value)}
              inputMode="numeric"
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
            />
            <p className="mt-1 text-xs text-gray-500">
              Lowest first — the order locations appear in every dropdown.
            </p>
          </div>

          {error && <p className="text-sm text-red-600">{error}</p>}
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={close} disabled={busy}>
              Cancel
            </Button>
            <Button onClick={save} disabled={busy}>
              {busy ? "Saving…" : "Save"}
            </Button>
          </div>
        </div>
      </Modal>

      <Modal
        open={removing !== null}
        onClose={() => setRemoving(null)}
        title="Remove this location?"
      >
        <p className="text-sm text-gray-600">
          {removing && removing.active_class_count > 0 ? (
            <>
              &ldquo;{removing.name}&rdquo; is used by{" "}
              <strong>
                {removing.active_class_count} active class
                {removing.active_class_count === 1 ? "" : "es"}
              </strong>
              . Move or retire those classes first, then remove it.
            </>
          ) : removing && removing.retired_class_count > 0 ? (
            <>
              &ldquo;{removing.name}&rdquo; will be removed from your list and every
              picker. The {removing.retired_class_count} retired class
              {removing.retired_class_count === 1 ? "" : "es"} still held here keep
              it for their records. You can reuse the name afterwards.
            </>
          ) : (
            <>
              &ldquo;{removing?.name}&rdquo; will be removed from your list and every
              picker. You can reuse the name afterwards.
            </>
          )}
        </p>
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="outline" onClick={() => setRemoving(null)} disabled={busy}>
            Cancel
          </Button>
          <Button
            onClick={() => removing && remove(removing)}
            disabled={busy || (removing?.active_class_count ?? 0) > 0}
            variant="danger"
          >
            {busy ? "Removing…" : "Remove"}
          </Button>
        </div>
      </Modal>
    </div>
  );
}
