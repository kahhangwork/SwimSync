import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import { useLowSettings } from "../domain/useLowSettings";
import { LowSettingsCard } from "./LowSettingsCard";

// The "running low" fields save when the admin LEAVES the field, not per
// keystroke: typing "20" as "2" then "20" used to send two PATCHes that could
// land out of order and store 2 (BACKLOG, 2026-09-25).
const { writes, updateLowPackageLessons, updatePackageExpiryDays } = vi.hoisted(() => {
  const writes: { resolve: (r: { error: unknown }) => void; n: number }[] = [];
  const pending = (_t: string, n: number) =>
    new Promise<{ error: unknown }>((resolve) => writes.push({ resolve, n }));
  return {
    writes,
    updateLowPackageLessons: vi.fn(pending),
    updatePackageExpiryDays: vi.fn(pending),
  };
});

vi.mock("../dao/packages.rpc", () => ({ myTenantId: async () => "t1" }));
vi.mock("../dao/packages.repo", () => ({
  loadLowSettings: async () => ({
    data: { low_package_lessons: 3, package_expiry_warning_days: 14 },
  }),
  updateLowPackageLessons,
  updatePackageExpiryDays,
}));

function Harness() {
  return <LowSettingsCard low={useLowSettings()} />;
}

async function setup() {
  render(<Harness />);
  const field = screen.getByLabelText("Low-package threshold in lessons") as HTMLInputElement;
  await waitFor(() => expect(field.disabled).toBe(false));
  expect(field.value).toBe("3");
  return field;
}

const type = (field: HTMLInputElement, v: string) => fireEvent.change(field, { target: { value: v } });

beforeEach(() => {
  writes.length = 0;
  updateLowPackageLessons.mockClear();
  updatePackageExpiryDays.mockClear();
});

describe("LowSettingsCard — save on leave, not per keystroke", () => {
  it("typing 2 then 20 saves nothing until blur, then saves 20 exactly once", async () => {
    const field = await setup();
    type(field, "2");
    type(field, "20");
    expect(updateLowPackageLessons).not.toHaveBeenCalled();
    fireEvent.blur(field);
    await waitFor(() => expect(updateLowPackageLessons).toHaveBeenCalledTimes(1));
    expect(updateLowPackageLessons).toHaveBeenCalledWith("t1", 20);
  });

  it("Enter saves too", async () => {
    const field = await setup();
    field.focus();
    type(field, "5");
    fireEvent.keyDown(field, { key: "Enter" });
    await waitFor(() => expect(updateLowPackageLessons).toHaveBeenCalledWith("t1", 5));
  });

  it("an empty field never saves 0 (§7.22), and an unchanged value sends nothing", async () => {
    const field = await setup();
    type(field, "");
    fireEvent.blur(field);
    type(field, "3"); // the stored value
    fireEvent.blur(field);
    await act(async () => {});
    expect(updateLowPackageLessons).not.toHaveBeenCalled();
  });

  it("a second save waits for the first — they cannot land out of order", async () => {
    const field = await setup();
    type(field, "5");
    fireEvent.blur(field);
    await waitFor(() => expect(writes).toHaveLength(1));
    type(field, "7");
    fireEvent.blur(field);
    await act(async () => {});
    expect(writes).toHaveLength(1); // 7 is queued behind 5
    await act(async () => writes[0].resolve({ error: null }));
    await waitFor(() => expect(writes.map((w) => w.n)).toEqual([5, 7]));
  });

  it("a failed save says so, and the same value can be retried", async () => {
    const field = await setup();
    type(field, "5");
    fireEvent.blur(field);
    await waitFor(() => expect(writes).toHaveLength(1));
    await act(async () => writes[0].resolve({ error: { message: "boom" } }));
    expect(await screen.findByText(/Couldn't save that setting/)).toBeTruthy();
    fireEvent.blur(field);
    await waitFor(() => expect(writes).toHaveLength(2));
    expect(writes[1].n).toBe(5);
  });
});

describe("LowSettingsCard — a thrown save does not wedge the queue", () => {
  it("after a write rejects, the error shows and the next save still goes out", async () => {
    updateLowPackageLessons.mockImplementationOnce(() => Promise.reject(new Error("network")));
    const field = await setup();
    type(field, "5");
    fireEvent.blur(field);
    expect(await screen.findByText(/Couldn't save that setting/)).toBeTruthy();
    type(field, "6");
    fireEvent.blur(field);
    await waitFor(() => expect(writes.map((w) => w.n)).toEqual([6]));
  });
});
