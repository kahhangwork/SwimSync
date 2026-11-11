import { describe, expect, it } from "vitest";
import { accountEmailOf } from "./accountEmail";

// The reset page names the account the recovery link is for (BACKLOG *UI restyle
// leftovers*). Display only: anything unexpected falls back to the generic copy.
describe("accountEmailOf", () => {
  it("reads the recovery session's email", () => {
    expect(accountEmailOf({ user: { email: "owner@swim.test" } })).toBe("owner@swim.test");
  });
  it("is null when there is no usable email — the page keeps its generic line", () => {
    expect(accountEmailOf(null)).toBeNull();
    expect(accountEmailOf({})).toBeNull();
    expect(accountEmailOf({ user: { email: "  " } })).toBeNull();
    expect(accountEmailOf({ user: { email: 42 } })).toBeNull();
  });
});
