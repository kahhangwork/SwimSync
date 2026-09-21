import { useEffect, useState } from "react";
import { loadAuditLog } from "../dao/history.repo";
import type { AuditRow } from "../types";

export function useHistory() {
  const [rows, setRows] = useState<AuditRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [entityFilter, setEntityFilter] = useState("All");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");

  // Re-queries when a filter moves, because both are applied in the DATABASE.
  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);

      const { data, error } = await loadAuditLog(entityFilter, dateFrom, dateTo);
      if (cancelled) return;

      if (error) {
        setLoadError(error.message);
        setRows([]);
        setLoading(false);
        return;
      }

      setLoadError(null);
      setRows(
        (data ?? []).map((r: any) => ({
          id: r.id,
          created_at: r.created_at,
          actor_id: r.actor_id ?? null,
          actor_name: r.profiles?.full_name ?? null,
          action: r.action,
          entity_type: r.entity_type,
          entity_id: r.entity_id,
          old_value: r.old_value,
          new_value: r.new_value,
        })),
      );
      setLoading(false);
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [entityFilter, dateFrom, dateTo]);

  const anyFilter = entityFilter !== "All" || dateFrom !== "" || dateTo !== "";

  function clearFilters() {
    setEntityFilter("All");
    setDateFrom("");
    setDateTo("");
  }

  return {
    rows,
    loading,
    loadError,
    entityFilter,
    setEntityFilter,
    dateFrom,
    setDateFrom,
    dateTo,
    setDateTo,
    anyFilter,
    clearFilters,
  };
}
