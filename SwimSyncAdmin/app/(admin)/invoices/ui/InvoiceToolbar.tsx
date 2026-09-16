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
        <div className="flex overflow-hidden rounded-xl border border-gray-200 bg-white focus-within:ring-2 focus-within:ring-sky-400">
          <select
            value={searchField}
            onChange={(e) => setSearchField(e.target.value as SearchField)}
            className="border-r border-gray-200 bg-gray-50 px-2 py-2.5 text-sm text-gray-600 focus:outline-none"
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
            className="w-52 px-4 py-2.5 text-sm placeholder-gray-400 focus:outline-none"
          />
        </div>
        <div className="flex gap-1.5">
          {STATUS_FILTERS.map((f) => (
            <button
              key={f}
              onClick={() => setStatusFilter(f)}
              className={`rounded-lg px-3 py-2 text-xs font-semibold transition-colors ${
                statusFilter === f
                  ? "bg-sky-500 text-white"
                  : "bg-white border border-gray-200 text-gray-600 hover:bg-gray-50"
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
        <div className="mb-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-2.5 text-sm text-amber-900">
          {exportNotice}
        </div>
      )}
    </>
  );
}
