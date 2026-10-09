import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { BacklogDrawModal } from "./BacklogDrawModal";
import type { BacklogDraw } from "../domain/useBacklogDraw";
import type { BacklogRow } from "../domain/backlogDraw";

// The D5 question. Load-bearing: both answers are offered and neither is a
// default; each row says who pays it; after a draw only Close remains, with
// the DRAW's count; a refusal shows the DB's words.

const ROW = (over: Partial<BacklogRow> = {}): BacklogRow => ({
  session_date: "2026-09-04",
  student_id: "s1",
  student_name: "Ava",
  class_title: "Dolphins Fri 4pm",
  funding_package_id: "pkg-1",
  funding_package_name: "10 lessons",
  funds_this: true,
  ...over,
});

function setup(backlog: Partial<NonNullable<BacklogDraw["backlog"]>> = {}, drawing = false) {
  const form: BacklogDraw = {
    backlog: {
      packageId: "pkg-1",
      packageName: "10 lessons",
      rows: [ROW(), ROW({ student_id: "s2", student_name: "Ben", funds_this: false, funding_package_id: null, funding_package_name: null })],
      drawn: null,
      error: null,
      source: "activation",
      ...backlog,
    },
    drawing,
    checking: null,
    offer: vi.fn(),
    check: vi.fn(),
    draw: vi.fn(),
    dismiss: vi.fn(),
  };
  render(<BacklogDrawModal form={form} />);
  return form;
}

describe("BacklogDrawModal", () => {
  it("offers both answers and says who pays each lesson", () => {
    const form = setup();
    expect(screen.getByText(/2 lessons since its start date were marked/)).toBeTruthy();
    expect(screen.getByText("1 lesson from this package")).toBeTruthy();
    expect(screen.getByText(/1 lesson no package can cover/)).toBeTruthy();
    expect(screen.getByText("this package")).toBeTruthy();
    expect(screen.getByText("stays ad-hoc")).toBeTruthy();

    fireEvent.click(screen.getByText("Draw from package"));
    expect(form.draw).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByText("Keep as ad-hoc"));
    expect(form.dismiss).toHaveBeenCalledTimes(1);
  });

  it("while drawing, both answers are locked", () => {
    setup({}, true);
    expect((screen.getByText("Drawing…").closest("button") as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByText("Keep as ad-hoc").closest("button") as HTMLButtonElement).disabled).toBe(true);
  });

  it("after a draw: the draw's count and only Close", () => {
    setup({ drawn: 1 });
    expect(screen.getByTestId("backlog-drawn").textContent).toBe("Drew 1 lesson from the family's packages.");
    expect(screen.queryByText("Draw from package")).toBeNull();
    expect(screen.queryByText("Keep as ad-hoc")).toBeNull();
    expect(screen.getByText("Close")).toBeTruthy();
  });

  it("a check from the Held table words the question as a check, not an activation", () => {
    setup({ source: "check" });
    expect(screen.getByText(/2 lessons marked since/)).toBeTruthy();
    expect(screen.queryByText(/is active/)).toBeNull();
    expect(screen.getByText("Draw from package")).toBeTruthy();
    expect(screen.getByText("Keep as ad-hoc")).toBeTruthy();
  });

  it("a check that found nothing says so, with Close only", () => {
    const form = setup({ source: "check", rows: [] });
    expect(screen.getByTestId("backlog-empty").textContent).toMatch(/Nothing to draw/);
    expect(screen.queryByText("Draw from package")).toBeNull();
    expect(screen.queryByText("Keep as ad-hoc")).toBeNull();
    fireEvent.click(screen.getByText("Close"));
    expect(form.dismiss).toHaveBeenCalledTimes(1);
  });

  it("a refusal shows the DB's words and keeps both answers", () => {
    setup({ error: "this business does not draw packages at marking yet" });
    expect(screen.getByRole("alert").textContent).toBe("this business does not draw packages at marking yet");
    expect(screen.getByText("Draw from package")).toBeTruthy();
  });
});
