import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { StatusBadge } from "@/components/StatusBadge";

// DESIGN.md → Status scale. The tone a WORD takes is lib/statusTone.ts's job
// (statusTone.test.ts); this pins that the badge renders it, as a bordered tag.
describe("StatusBadge", () => {
  it("renders the status label", () => {
    render(<StatusBadge status="Paid" />);
    expect(screen.queryByText("Paid")).not.toBeNull();
  });

  it("an unpaid invoice is amber (Due), never red — red means stuck", () => {
    render(<StatusBadge status="Outstanding" />);
    const badge = screen.getByText("Outstanding");
    expect(badge.className).toContain("text-status-warning-text");
    expect(badge.className).toContain("border-status-warning-border");
    expect(badge.className).not.toContain("danger");
  });

  it("Claimed is its own Info tag", () => {
    render(<StatusBadge status="Claimed" />);
    expect(screen.getByText("Claimed").className).toContain("text-status-info-text");
  });

  it("an explicit tone outranks the word's", () => {
    render(<StatusBadge status="Open" tone="danger" />);
    expect(screen.getByText("Open").className).toContain("text-status-danger-text");
  });

  it("falls back to neutral for an unknown status", () => {
    render(<StatusBadge status="Whatever" />);
    const badge = screen.getByText("Whatever");
    expect(badge.className).toContain("text-status-neutral-text");
    expect(badge.className).toContain("bg-status-neutral-bg");
  });

  it("is a 4px bordered tag, not a pill", () => {
    render(<StatusBadge status="Paid" />);
    const badge = screen.getByText("Paid");
    expect(badge.className).toMatch(/\brounded-tag\b/);
    expect(badge.className).not.toContain("rounded-full");
    expect(badge.className).toMatch(/\bborder\b/);
  });
});
