import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { LessonCard } from "@/components/calendar/LessonCard";
import type { CalendarLesson } from "@/lib/calendarLessons";

const BASE: CalendarLesson = {
  key: "c1|2026-08-19",
  classId: "c1",
  date: "2026-08-19",
  sessionId: null,
  start: "10:00",
  end: "11:00",
  startMin: 600,
  endMin: 660,
  title: "Mon Beginners",
  location: "Clementi",
  colourKey: "rose",
  capacity: 6,
  enrolled: 4,
  guests: 1,
  mainCoach: { id: "coachA", name: "Coach A", isCover: false },
  subName: null,
  shadowNames: [],
  progress: "upcoming",
  marked: 0,
  offPattern: false,
  holidayName: null,
  students: [],
};

describe("LessonCard", () => {
  it("shows title, coach and the 4+1/6 count, and NOT the time (the grid axis says it)", () => {
    render(<LessonCard lesson={BASE} />);
    expect(screen.getByText("Mon Beginners")).toBeTruthy();
    expect(screen.getByText("Coach A")).toBeTruthy();
    expect(screen.getByTestId("lesson-count").textContent).toBe("4+1/6");
    expect(screen.queryByText(/10:00/)).toBeNull();
  });

  it("flags a full class in red with FULL, counting guests toward capacity", () => {
    render(<LessonCard lesson={{ ...BASE, enrolled: 5, guests: 1 }} />);
    expect(screen.getByTestId("lesson-count").className).toContain("text-red-600");
    expect(screen.getByText("FULL")).toBeTruthy();
  });

  it("names the substitute with (Sub)", () => {
    render(<LessonCard lesson={{ ...BASE, mainCoach: { id: "coachB", name: "Coach B", isCover: true }, subName: "Coach B" }} />);
    expect(screen.getByText("Coach B")).toBeTruthy();
    expect(screen.getByText("(Sub)")).toBeTruthy();
  });

  it("uses the class colour, neutral grey when unset", () => {
    const { unmount } = render(<LessonCard lesson={BASE} />);
    expect(screen.getByTestId("lesson-card").className).toContain("bg-rose-100");
    unmount();
    render(<LessonCard lesson={{ ...BASE, colourKey: null }} />);
    expect(screen.getByTestId("lesson-card").className).toContain("bg-gray-100");
  });

  it("marks unmarked/partial lessons and fades a holiday", () => {
    const { unmount } = render(<LessonCard lesson={{ ...BASE, progress: "partial", marked: 2 }} />);
    expect(screen.getByText("2/5 marked")).toBeTruthy();
    expect(screen.getByTestId("lesson-card").className).toContain("border-dashed");
    unmount();
    render(<LessonCard lesson={{ ...BASE, progress: "holiday" }} />);
    expect(screen.getByText("Holiday")).toBeTruthy();
    expect(screen.getByTestId("lesson-card").className).toContain("opacity-50");
  });

  it("double-click and Enter open; single click pins", () => {
    const onOpen = vi.fn();
    const onPin = vi.fn();
    render(<LessonCard lesson={BASE} onOpen={onOpen} onPin={onPin} />);
    const card = screen.getByTestId("lesson-card");
    fireEvent.click(card);
    expect(onPin).toHaveBeenCalledTimes(1);
    expect(onOpen).not.toHaveBeenCalled();
    fireEvent.dblClick(card);
    expect(onOpen).toHaveBeenCalledWith(BASE);
    fireEvent.keyDown(card, { key: "Enter" });
    expect(onOpen).toHaveBeenCalledTimes(2);
  });

  it("compact layout is a single line with title and count", () => {
    render(<LessonCard lesson={BASE} layout="compact" />);
    const chip = screen.getByTestId("lesson-chip");
    expect(chip.textContent).toContain("Mon Beginners");
    expect(chip.textContent).toContain("4+1/6");
  });
});
