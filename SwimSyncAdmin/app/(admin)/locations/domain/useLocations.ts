import { useEffect, useState } from "react";
import { useTableSort } from "@/components/Table";
import { archiveLocation, loadLocations } from "../dao/locations.repo";
import type { Location } from "../types";

export function useLocations() {
  const [locations, setLocations] = useState<Location[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [removing, setRemoving] = useState<Location | null>(null);

  useEffect(() => {
    load();
  }, []);

  async function load() {
    setLoading(true);
    const { data } = await loadLocations();

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
    const { error: err } = await archiveLocation(l.id);
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

  // ⚠ The sort lives HERE, not in ui/LocationsTable (BATCH_E_PLAN.md RISK 4,
  // §7.249): load() flips `loading` on every reload, and the table renders
  // below that switch — so a sort held in the table would be destroyed after
  // every Save and every Remove.
  const sort = useTableSort<Location>({ key: "sort_order" });
  const visible = sort.apply(locations);

  return {
    locations,
    visible,
    sort,
    loading,
    busy,
    setBusy,
    error,
    setError,
    removing,
    setRemoving,
    remove,
    load,
  };
}
