import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { StatusBadge } from "@/components/StatusBadge";

describe("StatusBadge", () => {
  it("renders the status label", () => {
    render(<StatusBadge status="Paid" />);
    expect(screen.queryByText("Paid")).not.toBeNull();
  });

  it("maps a known status to its colour classes", () => {
    render(<StatusBadge status="Outstanding" />);
    const badge = screen.getByText("Outstanding");
    expect(badge.className).toContain("bg-red-100");
    expect(badge.className).toContain("text-red-700");
  });

  it("falls back to neutral classes for an unknown status", () => {
    render(<StatusBadge status="Whatever" />);
    const badge = screen.getByText("Whatever");
    expect(badge.className).toContain("bg-gray-100");
    expect(badge.className).toContain("text-gray-500");
  });
});
