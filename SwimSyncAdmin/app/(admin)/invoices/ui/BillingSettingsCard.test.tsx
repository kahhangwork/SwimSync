import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import type { ComponentProps } from "react";
import { BillingSettingsCard } from "./BillingSettingsCard";

// BillingSettingsCard — the automatic-generation toggle, the run day and the
// PayNow proxy, moved off the Generate card in UI restyle 5.1 (BACKLOG S10).
// Pure props; the saves live in the page's hooks. What is load-bearing here:
//   • UNKNOWN (null) auto/run-day/PayNow settings render as unknown and are not
//     editable — never as "off" / "day 7" / blank-and-editable, which presented
//     invented values as the business's configuration;
//   • the run day saves on BLUR, not per keystroke, with the number typed;
//   • each PayNow field saves under ITS OWN column — a swap would put a mobile
//     into paynow_uen and every invoice QR would pay the wrong proxy;
//   • the phone check is ADVISORY: it shows a message, it never blocks the save;
//   • an "Error…" save result reads in Danger, anything else in Success.
//
// MUTATION PROOFS (§7.25) — each applied to BillingSettingsCard.tsx, run,
// reverted, `git diff --exit-code` clean after (numbers kept from when these
// lived in GenerationPanel.test.tsx):
//   3. `onBlur={(e) => onSavePaynow("paynow_mobile", …)}` → `"paynow_uen"`
//      → RED: "each PayNow field saves under its own column, on blur" and
//        "a doubtful mobile is advised on, never blocked"
//   4. run-day `disabled={savingRunDay || runDay === null}` → `disabled={savingRunDay}`
//      → RED: "unknown settings (no business selected) are shown as unknown and locked"
//   5. `onBlur={(e) => onSaveRunDay(…)}` moved to `onChange` (saves per keystroke)
//      → RED: "the run day saves on blur with the typed number, not per keystroke"
//   7. toggle `aria-pressed={!!autoEnabled}` → `aria-pressed={true}`
//      → RED: "the auto toggle reflects the setting and calls the handler"
//   8. `{runDayMessage && (` → `{false && (` (a refused run-day save is silent again)
//      → RED: "a refused run-day save is said out loud, in red, and nothing when saved"

type Props = ComponentProps<typeof BillingSettingsCard>;

function setup(over: Partial<Props> = {}) {
  const props: Props = {
    autoEnabled: true,
    togglingAuto: false,
    onToggleAuto: vi.fn(),
    runDay: 5,
    setRunDay: vi.fn(),
    savingRunDay: false,
    runDayMessage: null,
    onSaveRunDay: vi.fn(),
    paynowUen: "",
    setPaynowUen: vi.fn(),
    paynowMobile: "",
    setPaynowMobile: vi.fn(),
    onSavePaynow: vi.fn(),
    paynowSaved: null,
    ...over,
  };
  const utils = render(<BillingSettingsCard {...props} />);
  return { props, ...utils };
}

const toggle = () =>
  screen.getByRole("button", { name: "Automatic monthly invoice generation" });
const runDay = () => screen.getByLabelText("Generate automatic invoices from day") as HTMLInputElement;
const uen = () => screen.getByLabelText("UEN") as HTMLInputElement;
const mobile = () => screen.getByLabelText("or mobile") as HTMLInputElement;

describe("BillingSettingsCard — automatic generation + run day", () => {
  it("the auto toggle reflects the setting and calls the handler", () => {
    const on = setup({ autoEnabled: true });
    expect(toggle().getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByText("Runs from day 5 for the previous month")).toBeTruthy();
    fireEvent.click(toggle());
    expect(on.props.onToggleAuto).toHaveBeenCalledTimes(1);
    on.unmount();

    setup({ autoEnabled: false });
    expect(toggle().getAttribute("aria-pressed")).toBe("false");
    expect(screen.getByText(/no effect while automatic generation is off/)).toBeTruthy();
  });

  it("unknown settings (no business selected) are shown as unknown and locked", () => {
    const { props } = setup({ autoEnabled: null, runDay: null, paynowUen: null, paynowMobile: null });
    expect(screen.getByText("No business selected")).toBeTruthy();
    // Never "day 7" — a number here reads as this business's configured day.
    expect(screen.queryByText(/Runs from day/)).toBeNull();
    expect((toggle() as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(toggle());
    expect(props.onToggleAuto).not.toHaveBeenCalled();
    expect(runDay().value).toBe("");
    expect(runDay().disabled).toBe(true);
    expect(uen().disabled).toBe(true);
    expect(mobile().disabled).toBe(true);
  });

  it("the run day saves on blur with the typed number, not per keystroke", () => {
    const { props } = setup({ runDay: 5 });
    expect(runDay().value).toBe("5");
    fireEvent.change(runDay(), { target: { value: "12" } });
    expect(props.setRunDay).toHaveBeenCalledWith(12);
    expect(props.onSaveRunDay).not.toHaveBeenCalled();
    fireEvent.blur(runDay(), { target: { value: "12" } });
    expect(props.onSaveRunDay).toHaveBeenCalledTimes(1);
    expect(props.onSaveRunDay).toHaveBeenCalledWith(12);
  });

  it("the run day is locked while it saves", () => {
    setup({ savingRunDay: true });
    expect(runDay().disabled).toBe(true);
  });
});

describe("BillingSettingsCard — PayNow", () => {
  it("each PayNow field saves under its own column, on blur", () => {
    const { props } = setup({ paynowUen: "201403121W", paynowMobile: "91234567" });
    expect(uen().value).toBe("201403121W");
    expect(mobile().value).toBe("91234567");

    fireEvent.change(uen(), { target: { value: "T12LL3456A" } });
    expect(props.setPaynowUen).toHaveBeenCalledWith("T12LL3456A");
    fireEvent.blur(uen(), { target: { value: "T12LL3456A" } });
    expect(props.onSavePaynow).toHaveBeenLastCalledWith("paynow_uen", "T12LL3456A");

    fireEvent.change(mobile(), { target: { value: "98765432" } });
    expect(props.setPaynowMobile).toHaveBeenCalledWith("98765432");
    fireEvent.blur(mobile(), { target: { value: "98765432" } });
    expect(props.onSavePaynow).toHaveBeenLastCalledWith("paynow_mobile", "98765432");
    expect(props.onSavePaynow).toHaveBeenCalledTimes(2);
  });

  it("a doubtful mobile is advised on, never blocked", () => {
    const { props } = setup({ paynowMobile: "964" });
    expect(screen.getByText(/Too short to be a phone number/)).toBeTruthy();
    expect(mobile().disabled).toBe(false);
    fireEvent.blur(mobile(), { target: { value: "964" } });
    expect(props.onSavePaynow).toHaveBeenCalledWith("paynow_mobile", "964");
  });

  it("a good mobile shows no advice", () => {
    setup({ paynowMobile: "91234567" });
    expect(screen.queryByText(/Too short|8 digits|does not look like/)).toBeNull();
  });

  it("the save result reads red on Error, green otherwise", () => {
    const { rerender, props } = setup({ paynowSaved: "Error: not allowed" });
    expect(screen.getByText("Error: not allowed").className).toMatch(/text-status-danger-text/);
    rerender(<BillingSettingsCard {...props} paynowSaved="Saved" />);
    expect(screen.getByText("Saved").className).toMatch(/text-status-success-text/);
  });

  it("a refused run-day save is said out loud, in red, and nothing when saved", () => {
    const { rerender, props } = setup({ runDayMessage: "Not saved — the run day is still 7." });
    const line = screen.getByText("Not saved — the run day is still 7.");
    expect(line.className).toMatch(/text-status-danger-text/);
    rerender(<BillingSettingsCard {...props} runDayMessage={null} />);
    expect(screen.queryByText(/Not saved|^Error:/)).toBeNull();
  });
});
