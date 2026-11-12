import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { WhatsAppQueue, type WaQueueRow } from "@/components/WhatsAppQueue";

// The queue is shared by invoice reminders and package offers. `priority`
// (overdue invoices first, OVERDUE_INVOICES_PLAN.md) must leave a caller that
// passes none — package offers — in exactly the order it had.
function nextName(rows: WaQueueRow[]): string | null {
  render(
    <WhatsAppQueue open onClose={() => {}} title="Q" intro="i" rows={rows} onOpenChat={() => {}} />
  );
  return screen.getByRole("button", { name: /Open next chat/ }).textContent;
}

const row = (id: string, over: Partial<WaQueueRow> = {}): WaQueueRow => ({
  id,
  parentName: id,
  waNumber: "6591234567",
  ...over,
});

describe("WhatsAppQueue ordering", () => {
  it("without priority: never-opened first, then oldest stamp (unchanged)", () => {
    expect(
      nextName([
        row("Opened", { openedStamp: "2026-11-01T02:00:00Z" }),
        row("Fresh"),
      ])
    ).toContain("Fresh");
  });

  it("a higher priority goes first, even ahead of a never-opened row", () => {
    expect(
      nextName([
        row("Fresh"),
        row("Overdue", { priority: 1, openedStamp: "2026-11-01T02:00:00Z" }),
      ])
    ).toContain("Overdue");
  });
});
