import { useEffect, useRef, useState } from "react";
import { exportCsv } from "@/lib/csv";
import { todayInSg } from "@/lib/lessonDates";
import { buildReminderMessage, buildWaLink } from "@/lib/waMessage";
import { useTableSort } from "@/components/Table";
import { useDebouncedValue } from "@/components/useDebouncedValue";
import { ROW_LIMIT, INVOICE_CSV_COLUMNS } from "../constants";
import type { InvoiceRow, SearchField } from "../types";
import * as repo from "../dao/invoices.repo";
import * as rpc from "../dao/invoices.rpc";
import {
  mapInvoiceRow,
  filterInvoices,
  invoiceLink,
  totalOutstanding,
} from "./invoiceRows";

/** The invoices list slice: the table's data, search/filter/sort, CSV export,
 *  mark-paid and the WhatsApp stamp. `load()` is returned because every write
 *  handler awaits it. */
export function useInvoiceList() {
  const [invoices, setInvoices] = useState<InvoiceRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [searchField, setSearchField] = useState<SearchField>("parent");
  const debouncedSearch = useDebouncedValue(search);
  const [capped, setCapped] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  // Only the newest load() may write state — an old term's slow response
  // must not overwrite a newer one.
  const invoiceSeq = useRef(0);
  const [statusFilter, setStatusFilter] = useState("All");
  const [exportNotice, setExportNotice] = useState<string | null>(null);
  const [markingPaid, setMarkingPaid] = useState<string | null>(null);
  const [queueOpen, setQueueOpen] = useState(false);
  const [copiedLink, setCopiedLink] = useState<string | null>(null);

  async function load() {
    const seq = ++invoiceSeq.current;
    setLoading(true);
    const term = search.trim();

    // Parent search is a DB pushdown; student search runs client-side over the
    // fetched set (why lives with the query, in dao/invoices.repo.ts).
    const { data, error } = await repo.fetchInvoices(term, searchField);
    if (seq !== invoiceSeq.current) return;
    // Surfaced, never swallowed: an empty table on a failed search reads as
    // "no invoices", the silent wrong answer this change exists to kill.
    if (error) {
      setLoadError(error.message);
      setInvoices([]);
      setCapped(false);
      setLoading(false);
      return;
    }
    setLoadError(null);
    setCapped((data ?? []).length >= ROW_LIMIT);
    setInvoices((data ?? []).map(mapInvoiceRow));
    setLoading(false);
  }

  // Runs on mount, and again whenever the scoped search changes.
  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debouncedSearch, searchField]);

  /** Opens the pre-filled chat, then stamps reminded_at. The stamp means
   *  "chat opened", NOT "message sent" — the admin still presses Send, and
   *  the button stays enabled so re-opening is always possible. */
  async function handleWhatsApp(inv: InvoiceRow, businessName: string) {
    if (!inv.wa_number) return;
    const message = buildReminderMessage({
      businessName,
      studentNames: inv.student_name_list,
      billingMonth: inv.billing_month,
      amount: inv.net_amount,
      link: invoiceLink(inv),
      reference: inv.reference_number,
    });
    window.open(buildWaLink(inv.wa_number, message), "_blank", "noopener");
    const stamp = new Date().toISOString();
    const { error } = await repo.updateInvoiceReminded(inv.id, stamp);
    if (!error) {
      setInvoices((prev) =>
        prev.map((row) => (row.id === inv.id ? { ...row, reminded_at: stamp } : row))
      );
    }
  }

  async function handleMarkPaid(invoiceId: string) {
    setMarkingPaid(invoiceId);
    // ONE mark-paid path for every client (PRD §7.21) — see dao/invoices.rpc.ts.
    const { error } = await rpc.confirmInvoicePaid(invoiceId);
    setMarkingPaid(null);
    if (error) return;
    setInvoices((prev) =>
      prev.map((inv) => (inv.id === invoiceId ? { ...inv, status: "paid" } : inv))
    );
  }

  function copyLink(inv: InvoiceRow) {
    navigator.clipboard?.writeText(invoiceLink(inv));
    setCopiedLink(inv.id);
    setTimeout(() => setCopiedLink(null), 1500);
  }

  const filtered = filterInvoices(invoices, searchField, search, statusFilter);

  const sort = useTableSort<InvoiceRow>({
    // Newest billing month first, which is the order the query already returns
    // and the one an admin chasing payment wants.
    key: "billing_month",
    dir: "desc",
    accessors: {
      // Sort the AMOUNTS, not the rendered "−S$40.00" strings — a currency
      // string sorts by its leading character, so a minus sign and a dash would
      // decide the order before the number did.
      status: (inv) => (inv.status === "outstanding" ? "Outstanding" : "Paid"),
    },
  });
  const visible = sort.apply(filtered);

  function handleExportCsv() {
    const res = exportCsv(`invoices-${todayInSg()}.csv`, visible, INVOICE_CSV_COLUMNS, {
      sourceCount: invoices.length,
    });
    setExportNotice(
      res.ok
        ? null
        : `Too many invoices to export at once (the list is capped at ${res.cap}). ` +
            `Narrow it with the status filter, search, or a month, then export again.`
    );
  }

  return {
    invoices,
    loading,
    search,
    setSearch,
    searchField,
    setSearchField,
    capped,
    loadError,
    statusFilter,
    setStatusFilter,
    exportNotice,
    markingPaid,
    queueOpen,
    setQueueOpen,
    copiedLink,
    copyLink,
    load,
    handleWhatsApp,
    handleMarkPaid,
    handleExportCsv,
    filtered,
    sort,
    visible,
    totalOutstanding: totalOutstanding(invoices),
  };
}
