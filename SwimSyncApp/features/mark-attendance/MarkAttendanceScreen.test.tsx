// The coach's Mark Attendance SCREEN, whole — app/(coach)/classes/[id]/attendance.tsx
// rendered with only its network seam (the two dao modules) and expo-router mocked.
// The hooks have their own tests; this pins that the route WIRES them: a press on a
// card reaches the attendance that Save writes, Save is the hook's handleSave, Set all
// reaches the map, and a finished save leaves for the exit the route computed.
//   1. happy save — each child's mark is the row written, then the screen is left;
//   2. incomplete — the unmarked child is named, nothing is written, the screen stays;
//   3. Set all → save — every child written, a public-holiday void left out (d45e84d).
//
// ⚠ THE CLOCK IS PINNED. load() asks checkMarkableDate whether DATE has happened yet
// via todayInSg(); a literal date against the real clock renders the blocked screen
// one day and expires the next (§7.303, in jest — check-test-dates.sh does not scan
// jest). No fake timers: they fight RNTL's findBy/waitFor.
// ⚠ Wait on "Save Attendance", never the class title: the header is ONE Text,
// "{title} · {date}", and BlockedLesson shows the title too.
// A green press here says nothing about the drivers (§7.286).
//
// MUTATION PROOFS (§7.25) — applied to the ROUTE by mutate.sh, each RED as named:
//   S1 `onPress={handleSave}` → `onPress={() => {}}`  → "happy save" + "incomplete"
//   S2 `router.replace(exitHref as any);` → `void exitHref;` → "happy save"
//   S3 `setTop={setTop}` → `setTop={() => {}}`        → "happy save"
//   S4 `onSetAll={onSetAll}` → `onSetAll={() => {}}`  → "Set all → save"
import React from "react";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react-native";
import { dayOfWeekOf } from "@/lib/lessonDates";
import { calls, confirms, repoMock, resetHarness, toasts, when } from "./testing/saveHarness";

const DATE = "2026-09-05";

jest.mock("@/lib/lessonDates", () => ({
  ...jest.requireActual("@/lib/lessonDates"),
  todayInSg: () => "2026-09-05",
}));

// The house stub (AttendanceHeader.test.tsx): the real icon font loader throws under jest.
jest.mock("@expo/vector-icons", () => {
  const { Text } = jest.requireActual("react-native");
  return { Ionicons: (p: { name: string }) => <Text>{`icon:${p.name}`}</Text> };
});

const mockReplace = jest.fn();
jest.mock("expo-router", () => ({
  router: { replace: (...a: unknown[]) => mockReplace(...a) },
  useLocalSearchParams: () => ({ id: "class-1", date: "2026-09-05" }),
}));

jest.mock("./dao/markAttendance.repo", () => require("./testing/saveHarness").repoMock);
jest.mock("./dao/markAttendance.rpc", () => require("./testing/saveHarness").rpcMock);
jest.mock("@/store/useAppStore", () => ({
  useAppStore: (sel: any) => sel(require("./testing/saveHarness").store),
}));
jest.mock("@/lib/confirm", () => ({
  confirmAction: (...a: any[]) => require("./testing/saveHarness").confirmAction(...a),
}));
jest.mock("@/lib/supabase", () => require("./testing/saveHarness").supabaseTripwire);

// eslint-disable-next-line import/first
import MarkAttendanceScreen from "@/app/(coach)/classes/[id]/attendance";

const enrol = (id: string, full_name: string) => ({
  is_active: true,
  enrolled_at: "2026-01-01T00:00:00+08:00",
  unenrolled_at: null,
  students: { id, full_name },
});

/** An existing, uncancelled lesson on the class's own weekday, owned by me. */
function lesson(roster: { id: string; name: string }[], attendance: unknown[] = []) {
  when("loadClass", async () => ({
    data: {
      title: "Tadpoles",
      day_of_week: dayOfWeekOf(DATE),
      coach_id: "coach-1",
      student_class_enrolments: roster.map((s) => enrol(s.id, s.name)),
    },
    error: null,
  }));
  when("loadSession", async () => ({
    data: { id: "sess-1", cancelled_at: null, cancellation_reason: null },
    error: null,
  }));
  when("loadAttendance", async () => ({ data: attendance, error: null }));
}

async function renderMarkable() {
  render(<MarkAttendanceScreen />);
  await screen.findByText("Save Attendance");
  expect(
    screen.queryByText(/hasn't happened yet|is closed|isn't a lesson day|cancelled|could not be loaded/)
  ).toBeNull();
}

/** The card for one child — the nearest ancestor holding its status row. */
function card(name: string) {
  let node = screen.getByText(name).parent;
  while (node && within(node).queryAllByText("Absent").length === 0) {
    node = node.parent;
  }
  if (!node) throw new Error(`no card for ${name}`);
  return within(node);
}

function upserted(): { student_id: string; status: string; lesson_session_id: string }[] {
  const c = calls.filter((x) => x.fn === "upsertAttendance");
  expect(c).toHaveLength(1);
  return c[0].args[0] as any;
}

beforeEach(() => {
  resetHarness();
  mockReplace.mockClear();
});

describe("Mark Attendance screen", () => {
  it("happy save: each child's mark is the row written, then the screen is left", async () => {
    lesson([
      { id: "s1", name: "Anna Tan" },
      { id: "s2", name: "Ben Lim" },
    ]);
    await renderMarkable();

    fireEvent.press(card("Anna Tan").getByText("Present"));
    fireEvent.press(card("Ben Lim").getByText("Absent"));
    fireEvent.press(screen.getByText("Save Attendance"));

    await waitFor(() => expect(mockReplace).toHaveBeenCalledWith("/(coach)/schedule"));
    expect(upserted().map(({ student_id, status, lesson_session_id }) => ({ student_id, status, lesson_session_id })))
      .toEqual([
        { student_id: "s1", status: "present", lesson_session_id: "sess-1" },
        { student_id: "s2", status: "absent", lesson_session_id: "sess-1" },
      ]);
    expect(toasts()).toContainEqual(["Attendance saved.", "success"]);
  });

  it("incomplete: the unmarked child is named, nothing is written, the screen stays", async () => {
    lesson([
      { id: "s1", name: "Anna Tan" },
      { id: "s2", name: "Ben Lim" },
    ]);
    await renderMarkable();

    fireEvent.press(card("Anna Tan").getByText("Present"));
    fireEvent.press(screen.getByText("Save Attendance"));

    await waitFor(() => expect(toasts()).toEqual([["Please mark attendance for Ben Lim.", "error"]]));
    await act(async () => {});
    expect(repoMock.upsertAttendance).not.toHaveBeenCalled();
    expect(mockReplace).not.toHaveBeenCalled();
    expect(screen.getByText("Save Attendance")).toBeTruthy();
  });

  it("Set all → save: every child written, a public-holiday void left out", async () => {
    lesson(
      [
        { id: "s1", name: "Anna Tan" },
        { id: "s2", name: "Ben Lim" },
        { id: "h", name: "Hana Goh" },
      ],
      [{ id: "att-h", student_id: "h", status: "holiday", students: { id: "h", full_name: "Hana Goh" } }]
    );
    await renderMarkable();

    fireEvent.press(screen.getByText("Set all"));
    const options = screen.getAllByText("Present");
    // SetAllMenu renders last, so its "Present" is the last one on screen.
    fireEvent.press(options[options.length - 1]);
    // The holiday row is not "unmarked", so Set all asks first.
    expect(confirms).toHaveLength(1);
    act(() => confirms[0].onConfirm());

    fireEvent.press(screen.getByText("Save Attendance"));

    await waitFor(() => expect(mockReplace).toHaveBeenCalledWith("/(coach)/schedule"));
    expect(upserted().map(({ student_id, status }) => ({ student_id, status }))).toEqual([
      { student_id: "s1", status: "present" },
      { student_id: "s2", status: "present" },
    ]);
  });
});
