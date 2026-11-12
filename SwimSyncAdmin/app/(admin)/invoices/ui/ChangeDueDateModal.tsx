"use client";

import { useEffect, useState } from "react";
import { Modal } from "@/components/Modal";
import { Button } from "@/components/Button";
import { dayMonthLabel, nextSgDay } from "@/lib/invoiceTag";
import type { InvoiceRow } from "../types";

/** Move ONE outstanding invoice's due date later (OVERDUE_INVOICES_PLAN.md D5).
 *  change_invoice_due_date() is the authority — later only, at most a year, billing
 *  edit — and its refusal is shown here verbatim. The parent is not told (D6). */
export function ChangeDueDateModal({
  invoice,
  saving,
  error,
  onClose,
  onSave,
}: {
  invoice: InvoiceRow | null;
  saving: boolean;
  error: string | null;
  onClose: () => void;
  onSave: (newDate: string, reason: string) => void;
}) {
  const [date, setDate] = useState("");
  const [reason, setReason] = useState("");

  // A fresh form for each invoice opened.
  useEffect(() => {
    setDate(invoice ? nextSgDay(invoice.due_date) : "");
    setReason("");
  }, [invoice]);

  return (
    <Modal title="Change due date" open={!!invoice} onClose={onClose}>
      {invoice && (
        <form
          className="space-y-3 pb-1"
          onSubmit={(e) => {
            e.preventDefault();
            onSave(date, reason);
          }}
        >
          <p className="text-body text-ink-secondary">
            {invoice.parent_name} · {invoice.reference_number} — due{" "}
            <strong className="text-ink">{dayMonthLabel(invoice.due_date)}</strong>. A due
            date can only move later. The family is not messaged; the new date shows in
            their app and on the payment link.
          </p>
          <div>
            <label htmlFor="new-due-date" className="block text-body font-medium text-ink mb-1">
              New due date
            </label>
            <input
              id="new-due-date"
              type="date"
              required
              min={nextSgDay(invoice.due_date)}
              value={date}
              onChange={(e) => setDate(e.target.value)}
              className="h-9 rounded-control border border-border-strong bg-surface px-2 text-body text-ink focus:outline-none focus:border-primary focus:ring-2 focus:ring-primary"
            />
          </div>
          <div>
            <label htmlFor="due-date-reason" className="block text-body font-medium text-ink mb-1">
              Reason <span className="font-normal text-ink-muted">(optional)</span>
            </label>
            <input
              id="due-date-reason"
              type="text"
              maxLength={500}
              value={reason}
              placeholder="e.g. family asked for more time"
              onChange={(e) => setReason(e.target.value)}
              className="h-9 w-full rounded-control border border-border-strong bg-surface px-2 text-body text-ink placeholder:text-ink-muted focus:outline-none focus:border-primary focus:ring-2 focus:ring-primary"
            />
          </div>
          {error && (
            <p role="alert" className="text-body font-medium text-status-danger-text">
              {error}
            </p>
          )}
          <div className="flex justify-end gap-2 pt-1">
            <Button type="button" variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" variant="primary" disabled={saving || date === ""}>
              {saving ? "Saving…" : "Save due date"}
            </Button>
          </div>
        </form>
      )}
    </Modal>
  );
}
