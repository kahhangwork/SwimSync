// Parents page — all state and orchestration. The page composes this hook and
// renders; it holds no useState of its own. Data access goes through dao/; the
// pure mapping/filter is parentsRows.ts.

import { useEffect, useState } from "react";
import { familyLessonsByParent } from "@/lib/packageCoverage";
import { todayInSg } from "@/lib/lessonDates";
import type { FamilyRow } from "../types";
import { loadFamilies, loadKids } from "../dao/parents.repo";
import { loadLiveBalances, setFamilyActiveDao } from "../dao/parents.rpc";
import { filterFamilies, toFamilyRows } from "./parentsRows";

export function useParents() {
  const [families, setFamilies] = useState<FamilyRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  // Defaults to SHOWING everything. A hide-by-default filter that is subtly
  // wrong looks exactly like data loss to the admin, so the safe default ships
  // first and the default flips once this page has been seen against real data.
  const [showInactive, setShowInactive] = useState(true);
  const [pending, setPending] = useState<FamilyRow | null>(null);
  const [pkgByParent, setPkgByParent] = useState<Map<string, number>>(new Map());
  const [takeChildren, setTakeChildren] = useState(true);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  useEffect(() => {
    load();
  }, []);

  async function load() {
    setLoading(true);
    const { data } = await loadFamilies();

    const rows = (data ?? []) as any[];
    const parentIds = rows.map((r) => r.parent_id);

    // Family-grain payment method: this page's rows are parents, so the
    // question is "does this family hold a live package here", not the
    // per-child category match (that is the Students page's chip).
    const { data: live } = await loadLiveBalances();
    setPkgByParent(familyLessonsByParent(live ?? [], todayInSg()));

    const { data: kids } = await loadKids(parentIds);

    setFamilies(toFamilyRows(rows, (kids ?? []) as any[]));
    setLoading(false);
  }

  function openModal(f: FamilyRow) {
    setTakeChildren(true);
    setActionError(null);
    setPending(f);
  }

  async function apply() {
    if (!pending) return;
    setBusy(true);
    setActionError(null);
    const activeKids = pending.children.filter((c) => c.is_active).map((c) => c.id);
    const { error } = await setFamilyActiveDao(
      pending.parent_id,
      pending.tenant_id,
      !pending.is_active,
      // Reactivating never touches children: status only, and the admin places
      // them deliberately. Deactivating cascades to the children shown.
      pending.is_active && takeChildren ? activeKids : []
    );
    setBusy(false);
    if (error) {
      setActionError(error);
      return;
    }
    setPending(null);
    await load();
  }

  const filtered = filterFamilies(families, search, showInactive);

  return {
    families,
    loading,
    search,
    setSearch,
    showInactive,
    setShowInactive,
    pending,
    setPending,
    openModal,
    pkgByParent,
    takeChildren,
    setTakeChildren,
    busy,
    actionError,
    apply,
    filtered,
  };
}
