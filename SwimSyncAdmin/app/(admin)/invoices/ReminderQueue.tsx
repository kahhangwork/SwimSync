"use client";

// The click-through WhatsApp reminder queue (payment collection Phase 2).
//
// One press of Send per parent is WhatsApp's anti-spam boundary — this queue
// exists to make everything AROUND that press free: each "Open next chat"
// opens the next pre-filled wa.me tab, stamps the row, and advances. The
// admin works down the list: click → Send → back → click.
//
// ⚠ RISK 7: the stamp means "chat opened", never "reminded"/"sent" — the
// admin may close a tab without sending. Copy below says exactly that, rows
// never disappear from the list when stamped, and re-opening is always
// possible.

import { useEffect, useMemo, useState } from "react";
import { MessageCircle } from "lucide-react";
import { Button } from "@/components/Button";
import { Modal } from "@/components/Modal";
import { checkSgPhone } from "@/lib/sgPhone";

export interface QueueRow {
  id: string;
  parent_name: string;
  student_names: string;
  net_amount: number;
  reference_number: string;
  reminded_at: string | null;
  wa_number: string | null;
  /** What the parent typed, for the advisory note on unusable numbers. */
  raw_phone: string | null;
}

export function ReminderQueue({
  open,
  onClose,
  rows,
  onOpenChat,
}: {
  open: boolean;
  onClose: () => void;
  /** Outstanding invoices only — the caller filters. */
  rows: QueueRow[];
  /** Opens the pre-filled chat + stamps the row (the page owns that logic). */
  onOpenChat: (id: string) => void;
}) {
  // Never-contacted first, then oldest chat-opened stamp — the parent who
  // has waited longest for a nudge is always next.
  const ordered = useMemo(
    () =>
      [...rows].sort((a, b) => {
        if (a.reminded_at === null && b.reminded_at !== null) return -1;
        if (a.reminded_at !== null && b.reminded_at === null) return 1;
        return (a.reminded_at ?? "").localeCompare(b.reminded_at ?? "");
      }),
    [rows]
  );
  const reachable = ordered.filter((r) => r.wa_number !== null);
  const unreachable = ordered.filter((r) => r.wa_number === null);

  const [openedIds, setOpenedIds] = useState<Set<string>>(new Set());
  // A fresh round each time the queue is opened — "n of m opened" refers to
  // THIS sitting, while the durable fact stays on each row's stamp.
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
    <Modal title="WhatsApp reminders — unpaid invoices" open={open} onClose={onClose}>
      <p className="text-xs text-gray-500 mb-3">
        Each click opens a pre-filled chat in a new tab — <b>you still press
        Send there</b>. A row is stamped when its chat was opened, which is not
        proof a message went out, so rows never leave this list until the
        invoice is paid.
      </p>

      <div className="mb-3 text-sm font-medium text-gray-700">
        {openedIds.size} of {reachable.length} chats opened this round
      </div>

      <div className="max-h-64 overflow-y-auto divide-y divide-gray-100 mb-4">
        {reachable.map((r) => (
          <div key={r.id} className="flex items-center justify-between py-2 gap-2">
            <div className="min-w-0">
              <div className="text-sm text-gray-900 truncate">
                {r.parent_name}{" "}
                <span className="text-gray-400">· {r.student_names}</span>
              </div>
              <div className="text-[11px] text-gray-400">
                S${r.net_amount.toFixed(2)} · {r.reference_number}
                {r.reminded_at &&
                  ` · chat opened ${new Date(r.reminded_at).toLocaleDateString("en-SG")}`}
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
                {r.parent_name} · {r.student_names}
                {r.raw_phone
                  ? ` — "${r.raw_phone}"${
                      checkSgPhone(r.raw_phone).message
                        ? ` (${checkSgPhone(r.raw_phone).message})`
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
          {next
            ? `Open next chat — ${next.parent_name}`
            : "All chats opened"}
        </Button>
      </div>
    </Modal>
  );
}
