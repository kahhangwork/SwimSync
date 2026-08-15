"use client";

// The invoice payment-reminder queue — now a thin wrapper over the shared
// WhatsAppQueue (components/WhatsAppQueue.tsx). It maps outstanding-invoice
// rows to the generic shape and keeps its own title + copy; the queue
// mechanics (ordering, "open next", the round counter, unreachable numbers)
// live in the shared component. The page still owns onOpenChat, which opens
// the pre-filled chat AND persists reminded_at (the durable stamp offers lack).
//
// ⚠ RISK 7: the stamp means "chat opened", never "sent". Copy below says so.

import { WhatsAppQueue, type WaQueueRow } from "@/components/WhatsAppQueue";

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
  const waRows: WaQueueRow[] = rows.map((r) => ({
    id: r.id,
    parentName: r.parent_name,
    subtitle: r.student_names,
    meta: `S$${r.net_amount.toFixed(2)} · ${r.reference_number}`,
    waNumber: r.wa_number,
    rawPhone: r.raw_phone,
    openedStamp: r.reminded_at,
  }));

  return (
    <WhatsAppQueue
      open={open}
      onClose={onClose}
      title="WhatsApp reminders — unpaid invoices"
      intro={
        <>
          Each click opens a pre-filled chat in a new tab — <b>you still press
          Send there</b>. A row is stamped when its chat was opened, which is
          not proof a message went out, so rows never leave this list until the
          invoice is paid.
        </>
      }
      rows={waRows}
      onOpenChat={onOpenChat}
    />
  );
}
