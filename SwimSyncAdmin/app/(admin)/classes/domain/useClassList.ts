import { useState } from "react";
import type { ClassRow, Coach } from "../types";
import { ROW_LIMIT } from "../constants";
import * as repo from "../dao/classes.repo";
import { mapClassRow, filterClasses } from "./classRows";

/**
 * The class list + the shared `coaches` spine. `load()` is returned because the
 * form (Stage 10) and retire/restore (Stage 9) await it after a write. `coaches`
 * is loaded here and passed down — the drawer's shadow name-lookup + warning and
 * the form's coach dropdown all read it, so it must not be fetched twice.
 */
export function useClassList() {
  const [classes, setClasses] = useState<ClassRow[]>([]);
  const [coaches, setCoaches] = useState<Coach[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  // True when the fetch came back at the cap, so the client-side search is over
  // a truncated slice — the banner then says so.
  const [capped, setCapped] = useState(false);
  // The location dropdown in the list toolbar; "" = all locations.
  const [locationFilter, setLocationFilter] = useState("");
  // Retired classes are hidden by DEFAULT, not absent (see the list toggle).
  const [showRetired, setShowRetired] = useState(false);

  async function load() {
    setLoading(true);
    const { data } = await repo.loadClasses();
    setCapped((data ?? []).length >= ROW_LIMIT);
    setClasses((data ?? []).map(mapClassRow));
    setLoading(false);
  }

  async function loadCoaches() {
    const [{ data }, { data: shadowRates }] = await Promise.all([
      repo.loadCoaches(),
      repo.loadShadowRates(),
    ]);
    const earliestShadowRate = new Map<string, string>();
    for (const r of (shadowRates ?? []) as any[]) {
      const seen = earliestShadowRate.get(r.coach_id);
      if (!seen || r.effective_from < seen) {
        earliestShadowRate.set(r.coach_id, r.effective_from);
      }
    }
    setCoaches(
      (data ?? []).map((c: any) => ({
        id: c.id,
        full_name: c.profiles?.full_name ?? "Unknown",
        shadowRateFrom: earliestShadowRate.get(c.id) ?? null,
      }))
    );
  }

  const filtered = filterClasses(classes, { search, locationFilter, showRetired });

  return {
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
    load,
    loadCoaches,
  };
}
