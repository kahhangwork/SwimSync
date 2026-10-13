import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import type { ComponentProps } from "react";
import { GenerationPanel } from "./GenerationPanel";

// GenerationPanel — month picker + Generate. Pure props; the run lives in the
// page's hooks. What is load-bearing here:
//   • the month picker is capped at the last COMPLETED month (an affordance —
//     the engine refuses too — but the first thing an admin meets);
//   • Generate cannot be pressed twice while a run is in flight;
//   • the last run's refusal is SHOWN beside Generate and never disables it
//     (plan UI_RESTYLE 5.1 ⚠ RISK 2 — the engine is the authority);
//   • an "Error…" result reads in Danger, anything else in Success.
// The settings that shared this card until UI restyle 5.1 are
// BillingSettingsCard.test.tsx's.
//
// MUTATION PROOFS (§7.25) — each applied to GenerationPanel.tsx, run, reverted,
// `git diff --exit-code` clean after:
//   1. `max={latestBillableMonth}` → removed
//      → RED: "caps the month picker at the last completed month"
//   2. `disabled={generating}` → `disabled={false}`
//      → RED: "Generate is disabled while a run is in flight"
//   6. `genResult.startsWith("Error") ? "text-status-danger-text"` → `"text-status-success-text"`
//      → RED: "an Error result reads red, a success reads green"
//   9. `disabled={generating}` → `disabled={generating || !!blockedReason}`
//      → RED: "a refused last run is shown beside Generate, which stays pressable"
//  10. `onClick={blockedReason.onReview}` → removed
//      → RED: "a refused last run is shown beside Generate, which stays pressable"

type Props = ComponentProps<typeof GenerationPanel>;

function setup(over: Partial<Props> = {}) {
  const props: Props = {
    genMonth: "2026-08",
    setGenMonth: vi.fn(),
    latestBillableMonth: "2026-08",
    generating: false,
    onGenerate: vi.fn(),
    genResult: null,
    ...over,
  };
  const utils = render(<GenerationPanel {...props} />);
  const monthInput = utils.container.querySelector('input[type="month"]') as HTMLInputElement;
  return { props, monthInput, ...utils };
}

describe("GenerationPanel — generation", () => {
  it("caps the month picker at the last completed month", () => {
    const { monthInput, props } = setup({ latestBillableMonth: "2026-08" });
    expect(monthInput.max).toBe("2026-08");
    fireEvent.change(monthInput, { target: { value: "2026-07" } });
    expect(props.setGenMonth).toHaveBeenCalledWith("2026-07");
  });

  it("Generate calls the handler", () => {
    const { props } = setup();
    fireEvent.click(screen.getByRole("button", { name: /Generate Invoices/ }));
    expect(props.onGenerate).toHaveBeenCalledTimes(1);
  });

  it("Generate is disabled while a run is in flight", () => {
    const { props } = setup({ generating: true });
    const btn = screen.getByRole("button", { name: /Generating…/ });
    expect((btn as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(btn);
    expect(props.onGenerate).not.toHaveBeenCalled();
  });

  it("an Error result reads red, a success reads green", () => {
    const { rerender, props } = setup({ genResult: "Error: 3 lessons unmarked" });
    expect(screen.getByText("Error: 3 lessons unmarked").className).toMatch(/text-status-danger-text/);
    rerender(<GenerationPanel {...props} genResult="Generated 12 invoices" />);
    expect(screen.getByText("Generated 12 invoices").className).toMatch(/text-status-success-text/);
  });

  it("a refused last run is shown beside Generate, which stays pressable", () => {
    const onReview = vi.fn();
    const { props } = setup({ blockedReason: { monthLabel: "Aug 2026", count: 20, onReview } });
    expect(screen.getByTestId("generate-blocked-reason").textContent).toMatch(
      /Last run for Aug 2026 refused · 20 lessons unmarked/
    );
    const btn = screen.getByRole("button", { name: /Generate Invoices/ }) as HTMLButtonElement;
    expect(btn.disabled).toBe(false);
    fireEvent.click(btn);
    expect(props.onGenerate).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: "→ Review" }));
    expect(onReview).toHaveBeenCalledTimes(1);
  });

  it("no reason line when the last run did not refuse", () => {
    setup({ blockedReason: null });
    expect(screen.queryByTestId("generate-blocked-reason")).toBeNull();
  });
});
