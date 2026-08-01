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

  it("tints amber at or below the low threshold", () => {
    render(<PackageChip coverage={pkg(2)} lowThreshold={2} />);
    expect(screen.getByText("Package · 2 left").className).toContain(
      "bg-amber-100"
    );
  });

  // ⚠ "Package · 0 left" — an exhausted package must read as an empty pool
  // needing a top-up, NEVER as ad-hoc, and 0 is always at or below any valid
  // threshold (they are constrained >= 0).
  it("renders an exhausted package as 0 left, tinted", () => {
    render(<PackageChip coverage={pkg(0)} lowThreshold={0} />);
    const chip = screen.getByText("Package · 0 left");
    expect(chip.className).toContain("bg-amber-100");
  });

  it("stays emerald above the threshold, or when no threshold is set", () => {
    render(<PackageChip coverage={pkg(3)} lowThreshold={2} />);
    expect(screen.getByText("Package · 3 left").className).toContain(
      "bg-emerald-100"
    );
    render(<PackageChip coverage={pkg(1)} />);
    expect(screen.getByText("Package · 1 left").className).toContain(
      "bg-emerald-100"
    );
  });
});
