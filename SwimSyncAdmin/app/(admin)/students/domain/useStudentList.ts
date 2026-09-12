// Slice 1 (list, search, filters) — the STATEFUL half. Stage 4 of
// docs/refactor/STUDENTS_PAGE_REFACTOR_PLAN.md.
//
// Owns the list, the scoped search, the status/low/unclaimed filters, and
// `load()` — the one query that feeds the entire page. Lifted from page.tsx
// with the state hooks and the comments intact; the mapping it applies lives
// in studentRows.ts. Every other slice's write handler still calls `load()`
// afterwards, exactly as before, so it is returned.

import { useEffect, useRef, useState } from "react";
import { useDebouncedValue } from "@/components/useDebouncedValue";
import * as repo from "../dao/students.repo";
import { ROW_LIMIT } from "../constants";
import type { SearchField, StudentRow } from "../types";
import { countLessons, toStudentRow } from "./studentRows";

export function useStudentList() {
  const [students, setStudents] = useState<StudentRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [searchField, setSearchField] = useState<SearchField>("student");
  // The search runs in the DATABASE, so each change of the term is a round trip
  // — debounced so typing a name is one query, not one per keystroke.
  const debouncedSearch = useDebouncedValue(search);
  // True when the last fetch came back at the cap, so the list is (probably)
  // truncated — the banner then tells the admin to search rather than scroll.
  const [capped, setCapped] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  // Only the latest load() may write state: a slow response to an old term must
  // not overwrite the newest one (the attendance page's guard, as a counter).
  const loadSeq = useRef(0);
  const [statusFilter, setStatusFilter] = useState("All");
  // ── "Running low" package filter ──────────────────────────────────────────
  // Families whose LIVE package balance (stored minus attended-but-uninvoiced
  // draws — package_live_balances(), the single derivation, never recomputed
  // here) is at or below the business's own threshold. The threshold is
  // per-tenant (tenants.low_package_lessons): what counts as "running low" is
  // the business's call, not a constant SwimSync picks for everyone.
  // Families with NO package are never "running low" — they are ad-hoc.
  const [lowOnly, setLowOnly] = useState(false);
  const [unclaimedOnly, setUnclaimedOnly] = useState(false);

  async function load() {
    const seq = ++loadSeq.current;
    const term = search.trim();

    // The embed shape and the scoped `.ilike` live with the query
    // (dao/students.repo.ts, fetchStudents) — read its comment before touching
    // either.
    const { data, error } = await repo.fetchStudents(term, searchField);
    const { data: att } = await repo.fetchAttendanceStudentIds();
    const lessonCount = countLessons(att as { student_id: string }[] | null);

    // A newer search has overtaken this one — drop the response rather than
    // repaint the table with a stale term's rows.
    if (seq !== loadSeq.current) return;
    // Surfaced, not swallowed: a failed search would otherwise empty the table
    // and read as "no students" — the silent wrong answer this change kills.
    if (error) {
      setLoadError(error.message);
      setCapped(false);
      setLoading(false);
      return;
    }
    setLoadError(null);
    setCapped((data ?? []).length >= ROW_LIMIT);
    setStudents((data ?? []).map((s: any) => toStudentRow(s, lessonCount)));
    setLoading(false);
  }

  // Runs on mount, and again whenever the scoped search changes. The dropdown +
  // debounced term are the only inputs the DB query reads.
  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debouncedSearch, searchField]);

  return {
    students,
    loading,
    loadError,
    capped,
    search,
    setSearch,
    searchField,
    setSearchField,
    statusFilter,
    setStatusFilter,
    lowOnly,
    setLowOnly,
    unclaimedOnly,
    setUnclaimedOnly,
    load,
  };
}
