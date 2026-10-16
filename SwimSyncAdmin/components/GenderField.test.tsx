import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { GenderField } from "./GenderField";

// GenderField — nothing pressed until chosen (never pre-selected), the choice is exposed as aria-pressed (§7.378),
// and buttons are type="button" so a press inside a form never submits it.

describe("GenderField", () => {
  it("with no value, neither option is pressed", () => {
    render(<GenderField value="" onChange={() => {}} />);
    expect(screen.getByRole("button", { name: "Male" }).getAttribute("aria-pressed")).toBe("false");
    expect(screen.getByRole("button", { name: "Female" }).getAttribute("aria-pressed")).toBe("false");
  });

  it("the chosen option is pressed, the other is not", () => {
    render(<GenderField value="female" onChange={() => {}} />);
    expect(screen.getByRole("button", { name: "Female" }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByRole("button", { name: "Male" }).getAttribute("aria-pressed")).toBe("false");
  });

  it("a press reports the value and never submits a form", () => {
    const onChange = vi.fn();
    render(<GenderField value="" onChange={onChange} />);
    const male = screen.getByRole("button", { name: "Male" });
    expect(male.getAttribute("type")).toBe("button");
    fireEvent.click(male);
    expect(onChange).toHaveBeenCalledWith("male");
  });
});
