import { describe, it, expect, vi } from "vitest";
import { renderHook, act, render, screen } from "@testing-library/react";

// "Change start date" on the class roster (Wave 4, D2/D9).
//   • Save sends mode "change" — never "add" (RISK 2);
//   • a LATER start lists the lessons that stop being expected (RISK 6); an
//     earlier one does not;
//   • an unchanged date sends nothing.
// No beforeEach clear — see components/StartsOnField.test.tsx; counts are deltas.

const { rpc } = vi.hoisted(() => ({
  rpc: {
    fetchStartBounds: vi.fn(),
    setEnrolmentStart: vi.fn(() => Promise.resolve({ data: {}, error: null })),
  },
}));
vi.mock("@/lib/enrolmentStart.rpc", () => rpc);
vi.mock("@/lib/supabase", () => {
  throw new Error("tripwire: ChangeStartModal test reached the real supabase client");
});

import { useChangeStart } from "../domain/useChangeStart";
import { ChangeStartModal } from "./ChangeStartModal";
import { todayInSg, dayOfWeekOf } from "@/lib/lessonDates";

const today = todayInSg();
const back = (days: number) => {
  const d = new Date(`${today}T12:00:00+08:00`);
  d.setUTCDate(d.getUTCDate() - days);
  return todayInSg(d);
};
const settle = () => act(() => new Promise((r) => setTimeout(r, 0)));
// Current start: 3 weeks back, on the class's weekday (today's), stored at noon SGT.
const current = back(21);
const target = {
  studentId: "s1",
  fullName: "Kai",
  classId: "c1",
  classTitle: "Mon 9am",
  enrolledAt: `${current}T04:00:00+00:00`,
};

async function setup() {
  rpc.fetchStartBounds.mockImplementation(() =>
    Promise.resolve({
      data: { floor: back(120), today, last_sealed_month: null, day_of_week: dayOfWeekOf(today) },
      error: null,
    })
  );
  const onDone = vi.fn();
  const h = renderHook(() => useChangeStart(onDone));
  act(() => h.result.current.open(target));
  await settle();
  return { ...h, onDone };
}

describe("ChangeStartModal", () => {
  it("a LATER start lists the lessons it stops expecting; Save sends mode 'change'", async () => {
    const { result, onDone } = await setup();
    act(() => result.current.start.setValue(back(7)));
    expect(result.current.dropped).toEqual([back(21), back(14)]);
    render(<ChangeStartModal c={result.current} />);
    expect(screen.getByTestId("dropped-dates").textContent).toContain("will no longer be expected on");
    const n = rpc.setEnrolmentStart.mock.calls.length;
    await act(() => result.current.save());
    expect(rpc.setEnrolmentStart.mock.calls.slice(n)).toEqual([["s1", "c1", back(7), "change"]]);
    expect(onDone).toHaveBeenCalled();
  });

  it("an EARLIER start into an unbilled month needs the second press", async () => {
    const { result } = await setup();
    act(() => result.current.start.setValue(back(49)));
    const n = rpc.setEnrolmentStart.mock.calls.length;
    await act(() => result.current.save());
    expect(rpc.setEnrolmentStart.mock.calls.length).toBe(n);
    await act(() => result.current.save());
    expect(rpc.setEnrolmentStart.mock.calls.slice(n)).toEqual([["s1", "c1", back(49), "change"]]);
  });

  it("an EARLIER start drops nothing", async () => {
    const { result } = await setup();
    act(() => result.current.start.setValue(back(28)));
    expect(result.current.dropped).toEqual([]);
    render(<ChangeStartModal c={result.current} />);
    expect(screen.queryByTestId("dropped-dates")).toBeNull();
  });

  it("an unchanged date sends nothing and Save is disabled", async () => {
    const { result } = await setup();
    render(<ChangeStartModal c={result.current} />);
    expect((screen.getByRole("button", { name: "Save" }) as HTMLButtonElement).disabled).toBe(true);
    const n = rpc.setEnrolmentStart.mock.calls.length;
    await act(() => result.current.save());
    expect(rpc.setEnrolmentStart.mock.calls.length).toBe(n);
  });
});
