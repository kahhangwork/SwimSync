import { useState } from "react";
import {
  getAuthUser,
  insertLocation,
  loadProfileTenantId,
  updateLocation,
} from "../dao/locations.repo";
import type { Location } from "../types";

type Deps = {
  locations: Location[];
  setBusy: (v: boolean) => void;
  setError: (v: string | null) => void;
  load: () => void;
};

export function useLocationForm({ locations, setBusy, setError, load }: Deps) {
  const [editing, setEditing] = useState<Location | null>(null);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [address, setAddress] = useState("");
  const [notes, setNotes] = useState("");
  const [sortOrder, setSortOrder] = useState("");

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

    // The auth → profile → write order is the page's own; the lookups only run
    // on the insert path, exactly as when they were nested inside the call.
    let err;
    if (editing) {
      ({ error: err } = await updateLocation(editing.id, payload));
    } else {
      const { data: auth } = await getAuthUser();
      const { data: profile } = await loadProfileTenantId(auth.user?.id);
      ({ error: err } = await insertLocation(payload, profile?.tenant_id));
    }

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

  return {
    editing,
    creating,
    name,
    setName,
    address,
    setAddress,
    notes,
    setNotes,
    sortOrder,
    setSortOrder,
    openCreate,
    openEdit,
    close,
    save,
  };
}
