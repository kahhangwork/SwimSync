import { describe, it, expect, vi } from "vitest";
import { renderHook, act, waitFor, render, screen } from "@testing-library/react";

// useStartsOn / StartsOnField (WAVE4_START_DATE_FRONT_DESK_PLAN.md §1.4).
//   • RISK 14: a bounds failure (rejected promise OR an error result) leaves the
//     field TODAY-ONLY — the Add works exactly as before, never disabled;
//   • RISK 1: a start in an earlier, unbilled month holds the FIRST press and
//     lets the second through; changing the date re-arms it;
//   • today is sent as null (the database keeps NOW()).

const { rpc } = vi.hoisted(() => ({ rpc: { fetchStartBounds: vi.fn() } }));
vi.mock("@/lib/enrolmentStart.rpc", () => rpc);
vi.mock("@/lib/supabase", () => {
  throw new Error("tripwire: StartsOnField test reached the real supabase client");
});

import { useStartsOn, StartsOnField } from "./StartsOnField";
import { todayInSg, dayOfWeekOf } from "@/lib/lessonDates";

const today = todayInSg();
const minus = (days: number) => {
  const d = new Date(`${today}T12:00:00+08:00`);
  d.setUTCDate(d.getUTCDate() - days);
  return todayInSg(d);
};
// A date in an EARLIER month, on today's weekday, 5–9 weeks back.
const earlier = minus(42);
const floor = minus(120);
const good = { floor, today, last_sealed_month: null, day_of_week: dayOfWeekOf(today) };

// NO beforeEach clear/reset: under vitest 4, clearing a spy whose earlier call
// returned a REJECTED promise re-raises that rejection from vitest's own result
// tracking — even though the hook handled it (bisected 2026-10-05). Each test sets
// its own implementation; the one that counts calls measures a delta.
// Let a rejected bounds call reach the hook's handler INSIDE the test.
const settle = () => act(() => new Promise((r) => setTimeout(r, 0)));

describe("useStartsOn", () => {
  it("RISK 14: a rejected bounds call → today only", async () => {
    rpc.fetchStartBounds.mockImplementation(() => Promise.reject(new Error("network")));
    const { result } = renderHook(() => useStartsOn("class-1"));
    await settle();
    expect(rpc.fetchStartBounds).toHaveBeenCalledWith("class-1");
    expect(result.current.bounds).toEqual({ floor: today, today, lastSealedMonth: null, dayOfWeek: null });
    expect(result.current.startsOnParam()).toBeNull();
    expect(result.current.holdForConfirmation()).toBe(false);
  });

  it("RISK 14: an error result → today only", async () => {
    rpc.fetchStartBounds.mockResolvedValue({ data: null, error: { message: "permission denied" } });
    const { result } = renderHook(() => useStartsOn("class-1"));
    await waitFor(() => expect(rpc.fetchStartBounds).toHaveBeenCalled());
    expect(result.current.bounds.floor).toBe(today);
  });

  it("RISK 1: an earlier unbilled month holds the first press, passes the second, re-arms on change", async () => {
    rpc.fetchStartBounds.mockResolvedValue({ data: good, error: null });
    const { result } = renderHook(() => useStartsOn("class-1"));
    await waitFor(() => expect(result.current.bounds.floor).toBe(floor));
    act(() => result.current.setValue(earlier));
    let held = false;
    act(() => {
      held = result.current.holdForConfirmation();
    });
    expect(held).toBe(true);
    expect(result.current.confirmPending).toBe(true);
    act(() => {
      held = result.current.holdForConfirmation();
    });
    expect(held).toBe(false);
    expect(result.current.startsOnParam()).toBe(earlier);
    act(() => result.current.setValue(minus(49)));
    expect(result.current.confirmPending).toBe(false);
  });

  it("no class → no bounds call, today only", () => {
    const before = rpc.fetchStartBounds.mock.calls.length;
    const { result } = renderHook(() => useStartsOn(null));
    expect(rpc.fetchStartBounds.mock.calls.length).toBe(before);
    expect(result.current.startsOnParam()).toBeNull();
  });
});

describe("StartsOnField", () => {
  it("RISK 14: the fallback renders a disabled today-only input and no warning", async () => {
    rpc.fetchStartBounds.mockImplementation(() => Promise.reject(new Error("network")));
    function Harness() {
      const s = useStartsOn("class-1");
      return <StartsOnField start={s} childName="Kai" />;
    }
    render(<Harness />);
    await settle();
    expect(rpc.fetchStartBounds).toHaveBeenCalled();
    const input = screen.getByLabelText("Starts on") as HTMLInputElement;
    expect(input.value).toBe(today);
    expect(input.disabled).toBe(true);
    expect(document.querySelector("[data-tone]")).toBeNull();
  });
});
