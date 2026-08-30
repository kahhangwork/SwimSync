"use client";

// The click-through WhatsApp queue — the shared shell behind the invoice
// payment reminders (invoices/ReminderQueue.tsx) and the package renewal
// offers (packages page). One press of Send per parent is WhatsApp's anti-spam
// boundary; this makes everything AROUND that press free: "Open next chat"
// opens the next pre-filled wa.me tab, stamps THIS round, and advances.
//
// ⚠ RISK 7 (payment collection): the round stamp means "chat opened", never
// "sent" — the admin may close a tab without sending. Rows never disappear
// when opened; re-opening is always possible. The DURABLE stamp (if any) is
// the caller's business — invoices persist a reminded_at, offers do not.

import { useEffect, useMemo, useState } from "react";
import { formatSgStamp } from "@/lib/lessonDates";
import { MessageCircle } from "lucide-react";
import { Button } from "@/components/Button";
import { Modal } from "@/components/Modal";
import { checkSgPhone } from "@/lib/sgPhone";

// The Singapore calendar date of a timestamptz, in the dd/mm/yyyy shape this
// page has always shown. `formatSgStamp` pins Asia/Singapore; the bare
// `toLocaleDateString("en-SG")` it replaced rendered the VIEWER's date, a day
// early west of Singapore for anything stamped before 08:00 SGT.
const DMY: Intl.DateTimeFormatOptions = {
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
};

export interface WaQueueRow {
  id: string;
  parentName: string;
  /** Children / student names — the "· ..." after the parent. */
  subtitle?: string | null;
  /** A one-line detail, e.g. "S$120.00 · INV-2026-0001". */
  meta?: string | null;
  /** 65XXXXXXXX for wa.me, or null when the number can't carry a chat. */
  waNumber: string | null;
  /** What the parent typed, for the advisory on an unusable number. */
  rawPhone?: string | null;
  /** A durable "chat opened" date (invoices persist one; offers pass null). */
  openedStamp?: string | null;
}

export function WhatsAppQueue({
  open,
  onClose,
  title,
  intro,
  rows,
  onOpenChat,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  intro: React.ReactNode;
  rows: WaQueueRow[];
  /** Opens the pre-filled chat + does any durable stamping (caller-owned). */
  onOpenChat: (id: string) => void;
}) {
  // Never-opened first, then oldest durable stamp — the parent who has waited
  // longest for a nudge is always next.
  const ordered = useMemo(
    () =>
      [...rows].sort((a, b) => {
        const as = a.openedStamp ?? null;
        const bs = b.openedStamp ?? null;
        if (as === null && bs !== null) return -1;
        if (as !== null && bs === null) return 1;
        return (as ?? "").localeCompare(bs ?? "");
      }),
    [rows]
  );
  const reachable = ordered.filter((r) => r.waNumber !== null);
  const unreachable = ordered.filter((r) => r.waNumber === null);

  const [openedIds, setOpenedIds] = useState<Set<string>>(new Set());
  // A fresh round each time the queue is opened — "n of m opened" refers to
  // THIS sitting, while any durable fact stays on the row.
  useEffect(() => {
    if (open) setOpenedIds(new Set());
  }, [open]);
  const next = reachable.find((r) => !openedIds.has(r.id));

  function openNext() {
    if (!next) return;
    onOpenChat(next.id);
    setOpenedIds((prev) => new Set(prev).add(next.id));
  }

  return (
    <Modal title={title} open={open} onClose={onClose}>
      <p className="text-xs text-gray-500 mb-3">{intro}</p>

      <div className="mb-3 text-sm font-medium text-gray-700">
        {openedIds.size} of {reachable.length} chats opened this round
      </div>

      <div className="max-h-64 overflow-y-auto divide-y divide-gray-100 mb-4">
        {reachable.map((r) => (
          <div key={r.id} className="flex items-center justify-between py-2 gap-2">
            <div className="min-w-0">
              <div className="text-sm text-gray-900 truncate">
                {r.parentName}
                {r.subtitle ? (
                  <span className="text-gray-400"> · {r.subtitle}</span>
                ) : null}
              </div>
              <div className="text-[11px] text-gray-400">
                {r.meta}
                {r.openedStamp &&
                  ` · chat opened ${formatSgStamp(r.openedStamp, DMY)}`}
              </div>
            </div>
            {openedIds.has(r.id) ? (
              <span className="text-[11px] text-emerald-600 shrink-0">opened</span>
            ) : next?.id === r.id ? (
              <span className="text-[11px] text-sky-600 shrink-0">next</span>
            ) : null}
          </div>
        ))}
        {unreachable.length > 0 && (
          <div className="pt-2">
            <div className="text-[11px] font-semibold text-amber-700 mb-1">
              Skipped — no usable phone number
            </div>
            {unreachable.map((r) => (
              <div key={r.id} className="text-[11px] text-gray-500 py-0.5">
                {r.parentName}
                {r.subtitle ? ` · ${r.subtitle}` : ""}
                {r.rawPhone
                  ? ` — "${r.rawPhone}"${
                      checkSgPhone(r.rawPhone).message
                        ? ` (${checkSgPhone(r.rawPhone).message})`
                        : ""
                    }`
                  : " — no phone on file"}
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="flex justify-end gap-2">
        <Button variant="ghost" onClick={onClose}>
          Done
        </Button>
        <Button variant="primary" disabled={!next} onClick={openNext}>
          <MessageCircle className="h-4 w-4" />
          {next ? `Open next chat — ${next.parentName}` : "All chats opened"}
        </Button>
      </div>
    </Modal>
  );
}
