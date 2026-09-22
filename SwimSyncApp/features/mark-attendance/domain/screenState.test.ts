// CHARACTERISATION test (COACH_ATTENDANCE_REFACTOR_PLAN.md, Stage 6): roleView returns
// exactly what the route computed inline — readOnly = !canMark(role), notice =
// roleNotice(role). §7.25 does not apply — a move, not a fix.
import { canMark, roleNotice, type LessonRole } from "@/lib/coachRoster";
import { isShowingDate, roleView } from "./screenState";
import { isShowingDate as libIsShowingDate } from "@/lib/attendanceSession";

describe("screenState (characterisation)", () => {
  const roles: LessonRole[] = ["owner", "cover", "shadow", "covered"];

  it("roleView === { !canMark(role), roleNotice(role) } for every role", () => {
    for (const role of roles) {
      expect(roleView(role)).toEqual({ readOnly: !canMark(role), notice: roleNotice(role) });
    }
  });

  it("the owner marks and sees no notice", () => {
    expect(roleView("owner")).toEqual({ readOnly: false, notice: null });
  });

  it("isShowingDate is the lib rule itself, re-exported", () => {
    expect(isShowingDate).toBe(libIsShowingDate);
  });
});

describe("screenState — the read-only roles", () => {
  it("shadow and covered are read-only with a notice; cover marks", () => {
    expect(roleView("shadow").readOnly).toBe(true);
    expect(roleView("covered").readOnly).toBe(true);
    expect(roleView("shadow").notice).not.toBeNull();
    expect(roleView("cover").readOnly).toBe(false);
  });
});
