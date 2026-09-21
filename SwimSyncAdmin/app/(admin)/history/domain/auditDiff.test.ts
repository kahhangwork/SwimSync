import { describe, it, expect } from "vitest";
import {
  diffSnapshots,
  formatAuditValue,
  actorLabel,
} from "./auditDiff";

describe("diffSnapshots", () => {
  it("an UPDATE shows only the fields that changed", () => {
    const d = diffSnapshots(
      { id: "x", status: "absent", note: "same" },
      { id: "x", status: "present", note: "same" },
    );
    expect(d.kind).toBe("updated");
    expect(d.changes).toEqual([
      { field: "status", from: "absent", to: "present" },
    ]);
  });

  it("a CREATE (null old) lists the new values", () => {
    const d = diffSnapshots(null, { full_name: "Ethan", is_active: true });
    expect(d.kind).toBe("created");
    expect(d.changes).toEqual([
      { field: "full_name", from: undefined, to: "Ethan" },
      { field: "is_active", from: undefined, to: true },
    ]);
  });

  it("a DELETE (null new) lists what was removed", () => {
    const d = diffSnapshots({ full_name: "Ethan" }, null);
    expect(d.kind).toBe("deleted");
    expect(d.changes).toEqual([{ field: "full_name", from: "Ethan", to: undefined }]);
  });

  it("treats structurally-equal nested values as unchanged", () => {
    const d = diffSnapshots(
      { tags: ["a", "b"], n: 1 },
      { tags: ["a", "b"], n: 2 },
    );
    expect(d.changes).toEqual([{ field: "n", from: 1, to: 2 }]);
  });

  it("returns unknown when neither side is an object", () => {
    expect(diffSnapshots(null, null).kind).toBe("unknown");
  });
});

describe("formatAuditValue", () => {
  it("renders primitives, JSON for objects, and — for null", () => {
    expect(formatAuditValue("present")).toBe("present");
    expect(formatAuditValue(30)).toBe("30");
    expect(formatAuditValue(null)).toBe("—");
    expect(formatAuditValue(undefined)).toBe("—");
    expect(formatAuditValue({ a: 1 })).toBe('{"a":1}');
  });
});

describe("actorLabel — ⚠ RISK 5", () => {
  it("renders the profile name when known", () => {
    expect(actorLabel("uuid-1", "Coach Amy")).toBe("Coach Amy");
  });

  it("a real (non-null) actor with no visible profile is 'unknown user', NEVER 'system'", () => {
    const label = actorLabel("abcd1234-5678", null);
    expect(label).toContain("unknown user");
    expect(label).not.toBe("system");
    expect(label).toContain("abcd1234");
  });

  it("only a null actor is 'system' (defensive — should not occur)", () => {
    expect(actorLabel(null, null)).toBe("system");
  });
});
