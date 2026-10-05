import { describe, it, expect, vi } from "vitest";
import { useState } from "react";
import { render } from "@testing-library/react";
import LessonPage from "./page";

// ⚠ THE PAGE BODY MUST REMOUNT WHEN THE URL NAMES ANOTHER LESSON (plan RISK 1,
// §7.64 admin side). The prev/next strip navigates in place; if the body
// survived, Save could pair the new lesson's classId/date with the old lesson's
// roster and draft and write one lesson's marks onto another. This pins the
// `key` on LessonBody, independent of whether Next's router happens to remount.
// §7.25: proven red with the key removed (mounts stayed at 1).

const { params, counter } = vi.hoisted(() => ({
  params: { classId: "A", date: "2026-08-17" },
  counter: { mounts: 0 },
}));

vi.mock("next/navigation", () => ({
  useParams: () => params,
  useRouter: () => ({ push: vi.fn() }),
}));

// Each mount of the body runs this initialiser exactly once.
vi.mock("./domain/useLessonDetail", () => ({
  useLessonDetail: () => {
    useState(() => ++counter.mounts);
    return { loading: true, loadError: null, cls: null, cancelled: null, notALesson: false, reload: () => {} };
  },
}));
vi.mock("./domain/useAttendanceSave", () => ({ useAttendanceSave: () => ({ saving: false, setSaveMsg: () => {} }) }));
vi.mock("./domain/useSubstitute", () => ({ useSubstitute: () => ({ coachBusy: false }) }));
vi.mock("./domain/useGuestBooking", () => ({ useGuestBooking: () => ({ bookBusy: false }) }));
vi.mock("./domain/useCancelLesson", () => ({ useCancelLesson: () => ({ cancelBusy: false }) }));
vi.mock("./domain/useLessonNav", () => ({ useLessonNav: () => ({ status: "none", nav: null }) }));

describe("LessonPage — lesson identity", () => {
  it("remounts the body when the lesson changes, and only then", () => {
    const { rerender } = render(<LessonPage />);
    expect(counter.mounts).toBe(1);

    rerender(<LessonPage />); // same lesson — no remount
    expect(counter.mounts).toBe(1);

    params.classId = "B"; // the strip's Next: another class, same date
    rerender(<LessonPage />);
    expect(counter.mounts).toBe(2);

    params.date = "2026-08-24"; // same class, another date
    rerender(<LessonPage />);
    expect(counter.mounts).toBe(3);
  });
});
