import { packageExtensionState } from "./packageExtension";

describe("packageExtensionState (parent surface)", () => {
  it("is 'none' with no extension", () => {
    expect(packageExtensionState(0, 0)).toBe("none");
  });

  it("is 'loud' when a new extension is unacknowledged", () => {
    expect(packageExtensionState(1, 0)).toBe("loud");
  });

  it("is 'quiet' once acknowledged", () => {
    expect(packageExtensionState(2, 2)).toBe("quiet");
  });

  it("re-alerts (loud) after a further holiday raises it above the ack", () => {
    expect(packageExtensionState(3, 2)).toBe("loud");
  });
});
