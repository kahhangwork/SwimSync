import { describe, it, expect, beforeEach, vi } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import { useLessonNav } from "./useLessonNav";
import type { CalendarData } from "../dao/lessonNav.repo";

// The strip's guards, through the real hook: a navigation never leaves unsaved
// marks or a running write behind (plan RISK 2), and the Calendar read fires
// once per lesson visit + once per teaching-coach change — never per Save
// (plan RISK 6). §7.25: (a), (d) and (e) were each proven red by breaking the
// hook (dirty branch removed / busy guard removed / effect keyed on ld.loading).

const { push, load } = vi.hoisted(() => ({
  push: vi.fn(),
  load: vi.fn(),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));
vi.mock("../dao/lessonNav.repo", () => ({ loadCalendarData: load }));

const DATE = "2026-08-17"; // a Monday

const DATA: CalendarData = {
  classes: [
    { id: "k1", title: "845am", day_of_week: "monday", start_time: "08:45:00", end_time: "09:30:00", location_name: "Pool",
      coach_id: "kah", colour: null, capacity: null, category_default_capacity: null, is_active: true, deactivated_at: null },
    { id: "k2", title: "930am", day_of_week: "monday", start_time: "09:30:00", end_time: "10:15:00", location_name: "Pool",
      coach_id: "kah", colour: null, capacity: null, category_default_capacity: null, is_active: true, deactivated_at: null },
  ],
  sessions: [],
  enrolments: [],
  bookings: [],
  attendance: [],
  substitutes: [],
  classRates: [
    { class_id: "k1", effective_from: "2000-01-01", paid_coach_id: "kah" },
    { class_id: "k2", effective_from: "2000-01-01", paid_coach_id: "kah" },
  ],
  shadows: [],
  absences: [],
  coachNames: new Map([["kah", "Kah Hang"]]),
  holidays: [],
  coachOptions: [{ id: "kah", name: "Kah Hang" }],
};

type Props = { date: string; loading: boolean; mainId: string | null; dirty: boolean; busy: boolean };
const BASE: Props = { date: DATE, loading: false, mainId: "kah", dirty: false, busy: false };

function setup(initial: Partial<Props> = {}) {
  return renderHook(
    (p: Props) =>
      useLessonNav({
        classId: "k1",
        date: p.date,
        // A fresh attr object every render, as the page's reload produces.
        ld: { loading: p.loading, attr: p.loading ? null : { mainId: p.mainId, isCover: false, subRowId: null, shadowIds: [] }, dirty: p.dirty },
        busy: p.busy,
      }),
    { initialProps: { ...BASE, ...initial } }
  );
}

beforeEach(() => {
  push.mockReset();
  load.mockReset();
  load.mockResolvedValue({ ok: true, data: DATA });
});

describe("useLessonNav — navigation guards (RISK 2)", () => {
  it("(a) unsaved marks: go opens the leave modal and does NOT navigate", async () => {
    const { result } = setup({ dirty: true });
    await waitFor(() => expect(result.current.status).toBe("ready"));
    act(() => result.current.go(result.current.nav!.lesson.nextHref));
    expect(result.current.leaveOpen).toBe(true);
    expect(push).not.toHaveBeenCalled();
  });

  it("(b) leave() navigates once, to the href that was asked for", async () => {
    const { result } = setup({ dirty: true });
    await waitFor(() => expect(result.current.status).toBe("ready"));
    act(() => result.current.go("/lessons/k2/2026-08-17"));
    act(() => result.current.leave());
    expect(push).toHaveBeenCalledTimes(1);
    expect(push).toHaveBeenCalledWith("/lessons/k2/2026-08-17");
    expect(result.current.leaveOpen).toBe(false);
  });

  it("(c) stay() closes the modal and never navigates", async () => {
    const { result } = setup({ dirty: true });
    await waitFor(() => expect(result.current.status).toBe("ready"));
    act(() => result.current.go("/lessons/k2/2026-08-17"));
    act(() => result.current.stay());
    expect(result.current.leaveOpen).toBe(false);
    expect(push).not.toHaveBeenCalled();
  });

  it("(d) a write in flight: go does nothing at all — no navigation, no modal", async () => {
    const { result } = setup({ busy: true, dirty: true });
    await waitFor(() => expect(result.current.status).toBe("ready"));
    act(() => result.current.go("/lessons/k2/2026-08-17"));
    expect(push).not.toHaveBeenCalled();
    expect(result.current.leaveOpen).toBe(false);
  });

  it("clean page: go navigates straight away", async () => {
    const { result } = setup();
    await waitFor(() => expect(result.current.status).toBe("ready"));
    expect(result.current.nav!.lesson.nextHref).toBe("/lessons/k2/2026-08-17");
    act(() => result.current.go(result.current.nav!.lesson.nextHref));
    expect(push).toHaveBeenCalledWith("/lessons/k2/2026-08-17");
  });
});

describe("useLessonNav — load count (RISK 6)", () => {
  it("(e) one load per visit; a Save's reload adds none; a teaching-coach change adds one", async () => {
    const { result, rerender } = setup({ loading: true });
    expect(load).toHaveBeenCalledTimes(0); // waits for the page's own load
    rerender({ ...BASE });
    await waitFor(() => expect(result.current.status).toBe("ready"));
    expect(load).toHaveBeenCalledTimes(1);

    // A Save: the page reloads (loading true → false), same teaching coach.
    rerender({ ...BASE, loading: true });
    rerender({ ...BASE });
    await waitFor(() => expect(result.current.status).toBe("ready"));
    expect(load).toHaveBeenCalledTimes(1);

    // A substitute assigned on this page: the teaching coach changes.
    rerender({ ...BASE, loading: true });
    rerender({ ...BASE, mainId: "amy" });
    await waitFor(() => expect(load).toHaveBeenCalledTimes(2));
    // The Calendar data still says Kah Hang → mismatch → the strip hides.
    await waitFor(() => expect(result.current.status).toBe("none"));
  });

  it("(f) an invalid date never loads", async () => {
    const { result } = setup({ date: "not-a-date" });
    await act(async () => {});
    expect(load).toHaveBeenCalledTimes(0);
    expect(result.current.status).toBe("none");
  });

  it("(g) a failed load reads 'unavailable', not a missing strip", async () => {
    load.mockResolvedValue({ ok: false, error: "boom" });
    const { result } = setup();
    await waitFor(() => expect(result.current.status).toBe("unavailable"));
    expect(result.current.nav).toBeNull();
  });
});
