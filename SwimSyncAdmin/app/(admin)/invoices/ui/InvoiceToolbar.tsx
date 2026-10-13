"use client";

import { Download, MessageCircle } from "lucide-react";
import { Button } from "@/components/Button";
import { STATUS_FILTERS } from "../constants";
import type { SearchField } from "../types";

export function InvoiceToolbar({
  searchField,
  setSearchField,
  search,
  setSearch,
  statusFilter,
  setStatusFilter,
  exportDisabled,
  remindersDisabled,
  onExportCsv,
  onOpenQueue,
  exportNotice,
}: {
  searchField: SearchField;
  setSearchField: (f: SearchField) => void;
  search: string;
  setSearch: (s: string) => void;
  statusFilter: string;
  setStatusFilter: (s: string) => void;
  exportDisabled: boolean;
  remindersDisabled: boolean;
  onExportCsv: () => void;
  onOpenQueue: () => void;
  exportNotice: string | null;
}) {
  return (
    <>
      <div className="flex flex-wrap gap-3 mb-4">
        {/* Scoped search — the dropdown picks the column the term is pushed into,
            so it reaches every invoice in the DB, not the first 1000 (⚠ RISK 3). */}
        <div className="flex overflow-hidden rounded-control border border-border-strong bg-surface focus-within:ring-2 focus-within:ring-primary">
          <select
            value={searchField}
            onChange={(e) => setSearchField(e.target.value as SearchField)}
            className="border-r border-border-strong bg-ground px-2 py-2.5 text-body text-ink-secondary focus:outline-none"
            aria-label="Search by"
          >
            <option value="parent">Parent</option>
            <option value="student">Student</option>
          </select>
          <input
            type="text"
            placeholder={searchField === "student" ? "Search student name…" : "Search parent name…"}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-52 px-4 py-2.5 text-body placeholder:text-ink-muted focus:outline-none"
          />
        </div>
        <div className="flex gap-1.5">
          {STATUS_FILTERS.map((f) => (
            <button
              key={f}
              onClick={() => setStatusFilter(f)}
              className={`rounded-control px-3 py-2 text-label font-semibold transition-colors ${
                statusFilter === f
                  ? "bg-selected text-ink border border-border-strong"
                  : "bg-surface border border-border text-ink-secondary hover:bg-ground"
              }`}
            >
              {f}
            </button>
          ))}
        </div>
        <div className="ml-auto flex gap-2">
          <Button variant="outline" disabled={exportDisabled} onClick={onExportCsv}>
            <Download className="h-4 w-4" />
            Export CSV
          </Button>
          <Button variant="outline" disabled={remindersDisabled} onClick={onOpenQueue}>
            <MessageCircle className="h-4 w-4" />
            WhatsApp reminders
          </Button>
        </div>
      </div>
      {exportNotice && (
        <div className="mb-4 rounded-card border border-status-warning-border bg-status-warning-bg px-4 py-2.5 text-body text-status-warning-text">
          {exportNotice}
        </div>
      )}
    </>
  );
}
