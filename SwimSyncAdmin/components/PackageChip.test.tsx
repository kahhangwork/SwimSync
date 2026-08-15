import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { PackageChip } from "@/components/PackageChip";

const pkg = (lessonsRemaining: number | null) => ({
  coverage: "package" as const,
  lessonsRemaining,
});

describe("PackageChip", () => {
  it("renders nothing when there is no coverage row (unclaimed child / failed RPC)", () => {
    const { container } = render(<PackageChip coverage={undefined} />);
    expect(container.innerHTML).toBe("");
  });

  it('says "Package · N left" for a covered child', () => {
    render(<PackageChip coverage={pkg(8)} />);
    const chip = screen.getByText("Package · 8 left");
    expect(chip.className).toContain("bg-emerald-100");
  });

  // Explicit BOTH ways: absence of a package is a positive label, never
  // just a missing chip.
  it('says "Ad-hoc" for an uncovered child', () => {
    render(
      <PackageChip coverage={{ coverage: "ad_hoc", lessonsRemaining: null }} />
    );
    const chip = screen.getByText("Ad-hoc");
    expect(chip.className).toContain("bg-gray-100");
  });

  it("renders the mixed state (unreachable today, honest if it ever isn't)", () => {
    render(
      <PackageChip coverage={{ coverage: "mixed", lessonsRemaining: 4 }} />
    );
    expect(screen.queryByText("Mixed · 4 left")).not.toBeNull();
  });

  // ⚠ "Package · 0 left" — an exhausted package must read as an empty pool, NEVER
  // as ad-hoc. It is still a package label.
  it("renders an exhausted package as 0 left, not ad-hoc", () => {
    render(<PackageChip coverage={pkg(0)} />);
    expect(screen.queryByText("Package · 0 left")).not.toBeNull();
  });

  // ⚠ RISK 10 — the chip no longer has amber "low" styling (that verdict lives
  // on the Students columns now). It is always emerald for a covered child.
  it("is always emerald — no threshold styling remains", () => {
    render(<PackageChip coverage={pkg(1)} />);
    expect(screen.getByText("Package · 1 left").className).toContain(
      "bg-emerald-100"
    );
  });
});
