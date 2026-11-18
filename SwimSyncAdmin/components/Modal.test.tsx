import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { Modal } from "./Modal";

describe("Modal", () => {
  // BACKLOG "The admin Modal's close (X) button has no accessible name": the X
  // is named, and its name must not contain "close" — drivers press a footer
  // Close by case-insensitive substring, and two matches fail strict mode.
  it("names the title-bar X for screen readers, without the word close", () => {
    const onClose = vi.fn();
    render(
      <Modal title="Edit" open onClose={onClose}>
        <button>Close</button>
      </Modal>,
    );
    const x = screen.getByRole("button", { name: "Dismiss" });
    fireEvent.click(x);
    expect(onClose).toHaveBeenCalledOnce();
    expect(screen.getAllByRole("button", { name: /close/i })).toHaveLength(1);
  });
});
