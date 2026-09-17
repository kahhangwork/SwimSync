import { useEffect, useRef, useState } from "react";
import { exportCsv } from "@/lib/csv";
import { todayInSg } from "@/lib/lessonDates";
import { coverageByStudent, type StudentCoverage } from "@/lib/packageCoverage";
import { useTableSort } from "@/components/Table";
import { useDebouncedValue } from "@/components/useDebouncedValue";
import { ROW_LIMIT } from "../constants";
import * as repo from "../dao/creditNotes.repo";
import * as rpc from "../dao/creditNotes.rpc";
import type { CreditNoteRow, SearchField, Viewer } from "../types";
import {
  CREDIT_NOTE_CSV_COLUMNS,
  creditNoteStatusLabel,
  toCreditNoteRow,
} from "./creditNoteRows";

// The list slice: the notes, the scoped DB search, the status filter + sort, the
// coverage chips, the viewer's own authority, and the CSV export. `setNotes` is
// returned so the resend/void hooks can apply their optimistic row updates.
export function useCreditNoteList() {
  const [notes, setNotes] = useState<CreditNoteRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [searchField, setSearchField] = useState<SearchField>("student");
  const debouncedSearch = useDebouncedValue(search);
  const [capped, setCapped] = useState(false);
  // Only the newest loadNotes() may write — an old term's slow response must not
  // overwrite a newer one.
  const noteSeq = useRef(0);
  const [statusFilter, setStatusFilter] = useState("All");
  const [covMap, setCovMap] = useState<Map<string, StudentCoverage>>(
    new Map()
  );
  // ⚠ RISK 4 — the viewer's OWN role and tenant, never a value off a row. The
  // select below is unfiltered and leans on RLS, which hands a platform admin every
  // business's notes; only a TENANT admin of a note's own business may email it.
  const [viewer, setViewer] = useState<Viewer>(
    { role: null, tenantId: null, adminDisabled: true }
  ); // deny-by-default until loaded
  const [loadError, setLoadError] = useState<string | null>(null);
  const [exportNotice, setExportNotice] = useState<string | null>(null);

  useEffect(() => {
    // Payment-method chips: fire-and-forget, a failed RPC only means no chips.
    rpc
      .studentPackageCoverage()
      .then(({ data: cov }) => setCovMap(coverageByStudent(cov ?? [])));
    // The viewer's OWN role/tenant, loaded once — email authority keys on it.
    (async () => {
      const { data: auth } = await repo.getAuthUser();
      if (auth?.user) {
        const { data: profile } = await repo.loadViewerProfile(auth.user.id);
        setViewer({
          role: profile?.role ?? null,
          tenantId: profile?.tenant_id ?? null,
          adminDisabled: profile?.admin_disabled_at != null,
        });
      }
    })();
  }, []);

  // Runs on mount, and again whenever the scoped search changes.
  useEffect(() => {
    loadNotes();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debouncedSearch, searchField]);

  async function loadNotes() {
    const seq = ++noteSeq.current;
    const term = search.trim();

    const { data, error } = await repo.loadNotes(term, searchField);
    if (seq !== noteSeq.current) return;

    if (error) {
      // Surfaced, not defaulted to "nothing is applied" — see ⚠ RISK 2 in dao.
      setLoadError(`Could not load credit notes: ${error.message}`);
      setLoading(false);
      return;
    }
    setLoadError(null);
    setCapped((data ?? []).length >= ROW_LIMIT);

    setNotes((data ?? []).map(toCreditNoteRow));
    setLoading(false);
  }

  // Search moved into the DB (scoped, past the 1000-row cap); the status filter
  // refines the fetched set here.
  const filtered = notes.filter((cn) => {
    const label = creditNoteStatusLabel(cn.status);
    return statusFilter === "All" || label === statusFilter;
  });

  const sort = useTableSort<CreditNoteRow>({
    key: "created_at",
    dir: "desc",
    accessors: {
      status: (cn) => creditNoteStatusLabel(cn.status),
    },
  });
  const visible = sort.apply(filtered);

  function handleExportCsv() {
    const res = exportCsv(
      `credit-notes-${todayInSg()}.csv`,
      visible,
      CREDIT_NOTE_CSV_COLUMNS,
      { sourceCount: notes.length },
    );
    setExportNotice(
      res.ok
        ? null
        : `Too many credit notes to export at once (the list is capped at ${res.cap}). ` +
            `Narrow it with the status filter or search, then export again.`,
    );
  }

  return {
    setNotes,
    loading,
    search, setSearch,
    searchField, setSearchField,
    capped,
    statusFilter, setStatusFilter,
    covMap,
    viewer,
    loadError,
    exportNotice,
    sort,
    visible,
    handleExportCsv,
  };
}
