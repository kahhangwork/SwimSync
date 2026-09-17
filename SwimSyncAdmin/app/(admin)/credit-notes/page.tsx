"use client";

// Credit Notes — auto-issued when attendance is corrected post-invoice; amounts
// are immutable, the parent's notification can be resent, a note can be voided.
//
// Composition only (Admin L-C): the list + scoped search + export in
// domain/useCreditNoteList, resend in domain/useResend, void in
// domain/useVoidNote, row mapping + labels + CSV columns in
// domain/creditNoteRows, the email/void authority views in
// domain/creditNote{Email,Void}State (moved from @/lib — sole importer), data in
// dao/creditNotes.{repo,rpc}, markup in ui/. See docs/refactor/BATCH_C_PLAN.md.

import { PageHeader } from "@/components/PageHeader";
import { ROW_LIMIT } from "./constants";
import { useCreditNoteList } from "./domain/useCreditNoteList";
import { useResend } from "./domain/useResend";
import { useVoidNote } from "./domain/useVoidNote";
import { CreditNotesToolbar } from "./ui/CreditNotesToolbar";
import { CreditNotesTable } from "./ui/CreditNotesTable";

export default function CreditNotesPage() {
  const list = useCreditNoteList();
  const { resending, resendError, resend } = useResend(list.setNotes);
  const v = useVoidNote(list.setNotes);
  const { loading, search, capped, loadError, exportNotice } = list;

  return (
    <div>
      <PageHeader
        title="Credit Notes"
        subtitle="Auto-issued when attendance is corrected post-invoice — amounts are immutable; the parent's notification can be resent"
      />

      {loadError && (
        <div className="mb-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {loadError}
        </div>
      )}

      <CreditNotesToolbar
        searchField={list.searchField}
        setSearchField={list.setSearchField}
        search={search}
        setSearch={list.setSearch}
        statusFilter={list.statusFilter}
        setStatusFilter={list.setStatusFilter}
        visibleCount={list.visible.length}
        onExport={list.handleExportCsv}
      />
      {exportNotice && (
        <div className="mb-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-2.5 text-sm text-amber-900">
          {exportNotice}
        </div>
      )}

      {!loading && capped && (
        <p className="mb-3 text-sm text-amber-700">
          Showing the first {ROW_LIMIT}{" "}
          {search.trim() ? "matches" : "credit notes"}.{" "}
          {search.trim()
            ? "Refine your search to narrow them."
            : "Search to find a specific one."}
        </p>
      )}

      <CreditNotesTable
        sort={list.sort}
        loading={loading}
        visible={list.visible}
        covMap={list.covMap}
        viewer={list.viewer}
        voidOpen={v.voidOpen}
        setVoidOpen={v.setVoidOpen}
        voidReason={v.voidReason}
        setVoidReason={v.setVoidReason}
        voiding={v.voiding}
        voidError={v.voidError}
        onVoid={v.voidNote}
        resending={resending}
        resendError={resendError}
        onResend={resend}
      />
    </div>
  );
}
