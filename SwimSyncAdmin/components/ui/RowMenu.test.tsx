import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { RowMenu, RowMenuItem } from "./RowMenu";

// RowMenu — the row "…" menu (DESIGN.md → Tables). What the drivers rely on:
// items are plain role="button"s that exist only while open, an item's press
// runs its handler and closes the menu, and a menu with no items renders nothing.
//
// MUTATION PROOFS (§7.25) — each applied to RowMenu.tsx, run, reverted:
//   1. `if (items.length === 0) return null;` → removed → RED: "no items, no trigger"
//   2. the panel's `onClick={() => setPos(null)}` → removed → RED: "an item runs its handler and closes the menu"

describe("RowMenu", () => {
  it("items appear only once the trigger is pressed", () => {
    render(
      <RowMenu>
        <RowMenuItem onClick={() => {}}>Void</RowMenuItem>
      </RowMenu>
    );
    expect(screen.queryByRole("button", { name: "Void" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "More actions" }));
    expect(screen.getByRole("button", { name: "Void" })).toBeTruthy();
  });

  it("an item runs its handler and closes the menu", () => {
    const onVoid = vi.fn();
    render(
      <RowMenu>
        <RowMenuItem onClick={onVoid}>Void</RowMenuItem>
      </RowMenu>
    );
    fireEvent.click(screen.getByRole("button", { name: "More actions" }));
    fireEvent.click(screen.getByRole("button", { name: "Void" }));
    expect(onVoid).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("button", { name: "Void" })).toBeNull();
  });

  it("Escape closes it", () => {
    render(
      <RowMenu>
        <RowMenuItem>Void</RowMenuItem>
      </RowMenu>
    );
    fireEvent.click(screen.getByRole("button", { name: "More actions" }));
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("button", { name: "Void" })).toBeNull();
  });

  it("no items, no trigger", () => {
    const { container } = render(<RowMenu>{false}</RowMenu>);
    expect(container.innerHTML).toBe("");
  });
});
