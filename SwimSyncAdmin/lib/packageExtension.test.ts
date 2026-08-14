import { describe, it, expect } from "vitest";
import { packageExtensionState } from "./packageExtension";

describe("packageExtensionState", () => {
  it("is 'none' when there is no extension", () => {
    expect(packageExtensionState(0, 0)).toBe("none");
  });

  it("is 'loud' when the extension exceeds the acknowledged amount", () => {
    expect(packageExtensionState(1, 0)).toBe("loud");
    expect(packageExtensionState(2, 1)).toBe("loud");
  });

  it("is 'quiet' once acknowledged up to the current extension", () => {
    expect(packageExtensionState(1, 1)).toBe("quiet");
    expect(packageExtensionState(2, 2)).toBe("quiet");
  });

  it("goes loud again when a later holiday raises the extension above the ack", () => {
    // Acked at 1, a new holiday bumps it to 2 → loud again.
    expect(packageExtensionState(2, 1)).toBe("loud");
  });

  it("stays quiet after a shrink clamps the ack down to the extension", () => {
    // The DB clamps ack = LEAST(ack, ext); it never exceeds ext.
    expect(packageExtensionState(1, 1)).toBe("quiet");
  });
});
