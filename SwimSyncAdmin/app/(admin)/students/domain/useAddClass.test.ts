import { describe, it, expect, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";

// useAddClass → set_enrolment_start (Wave 4, WAVE4_START_DATE_FRONT_DESK_PLAN.md §1.4):
//   • ONE call, mode "add" — never "change" from an Add screen (RISK 2);
//   • the default start is today, sent as null (the database keeps NOW());
//   • a start in an earlier, unbilled month holds the first press (RISK 1).
// No beforeEach clear — see components/StartsOnField.test.tsx; counts are deltas.

const { repo, rpc } = vi.hoisted(() => ({
  repo: { fetchActiveClasses: vi.fn(() => Promise.resolve({ data: [{ id: "c1", title: "Mon 9am" }], error: null })) },
  rpc: {
    fetchStartBounds: vi.fn(),
    setEnrolmentStart: vi.fn(() => Promise.resolve({ data: {}, error: null })),
  },
}));
vi.mock("../dao/students.repo", () => repo);
vi.mock("@/lib/enrolmentStart.rpc", () => rpc);
vi.mock("@/lib/supabase", () => {
  throw new Error("tripwire: useAddClass test reached the real supabase client");
});

import { useAddClass } from "./useAddClass";
import { todayInSg, dayOfWeekOf } from "@/lib/lessonDates";

const today = todayInSg();
const back = (days: number) => {
  const d = new Date(`${today}T12:00:00+08:00`);
  d.setUTCDate(d.getUTCDate() - days);
  return todayInSg(d);
};
const settle = () => act(() => new Promise((r) => setTimeout(r, 0)));
const student = { id: "s1", full_name: "Kai", classes: [] } as any;

async function setup() {
  rpc.fetchStartBounds.mockImplementation(() =>
    Promise.resolve({
      data: { floor: back(120), today, last_sealed_month: null, day_of_week: dayOfWeekOf(today) },
      error: null,
    })
  );
  const reload = vi.fn(() => Promise.resolve());
  const h = renderHook(() => useAddClass(reload));
  act(() => h.result.current.openAddClass(student));
  act(() => h.result.current.setAddClassChoice("c1"));
  await settle();
  return h;
}

describe("useAddClass", () => {
  it("adds with mode 'add' and today as null", async () => {
    const { result } = await setup();
    const n = rpc.setEnrolmentStart.mock.calls.length;
    await act(() => result.current.handleAddClass());
    expect(rpc.setEnrolmentStart.mock.calls.slice(n)).toEqual([["s1", "c1", null, "add"]]);
  });

  it("RISK 1: an earlier unbilled month → first press sends nothing, second sends the date", async () => {
    const { result } = await setup();
    const earlier = back(42);
    act(() => result.current.start.setValue(earlier));
    const n = rpc.setEnrolmentStart.mock.calls.length;
    await act(() => result.current.handleAddClass());
    expect(rpc.setEnrolmentStart.mock.calls.length).toBe(n);
    expect(result.current.start.confirmPending).toBe(true);
    await act(() => result.current.handleAddClass());
    expect(rpc.setEnrolmentStart.mock.calls.slice(n)).toEqual([["s1", "c1", earlier, "add"]]);
  });
});
