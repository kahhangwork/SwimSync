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
//   4. `Children.toArray(children)` → the old `Array.isArray(children) ? children.filter(Boolean) …`
//      → RED: "an empty map or a false child is no item — no trigger"
//   5. `trigger.current?.focus()` on Escape → removed → RED: "Escape returns focus to the trigger"
//   3. scroll listener `follow` → `close` (the first version) → RED: "a scroll keeps it open…" —
//      and verify-money-admin timed out on Void, 9/44, the run that found it.

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

  it("a scroll keeps it open (an item scrolled into view to be pressed must still be there)", () => {
    render(
      <RowMenu>
        <RowMenuItem>Void</RowMenuItem>
      </RowMenu>
    );
    fireEvent.click(screen.getByRole("button", { name: "More actions" }));
    fireEvent.scroll(window);
    expect(screen.getByRole("button", { name: "Void" })).toBeTruthy();
  });

  it("an empty map or a false child is no item — no trigger", () => {
    const none: string[] = [];
    const { container } = render(
      <RowMenu>
        {none.map((n) => (
          <RowMenuItem key={n}>{n}</RowMenuItem>
        ))}
        {false}
      </RowMenu>
    );
    expect(container.innerHTML).toBe("");
  });

  it("Escape returns focus to the trigger", () => {
    render(
      <RowMenu>
        <RowMenuItem>Void</RowMenuItem>
      </RowMenu>
    );
    const trig = screen.getByRole("button", { name: "More actions" });
    fireEvent.click(trig);
    screen.getByRole("button", { name: "Void" }).focus();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(document.activeElement).toBe(trig);
  });

  it("no items, no trigger", () => {
    const { container } = render(<RowMenu>{false}</RowMenu>);
    expect(container.innerHTML).toBe("");
  });
});
