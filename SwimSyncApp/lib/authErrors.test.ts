import { friendlyAuthError } from "./authErrors";

describe("friendlyAuthError", () => {
  it("maps invalid credentials to friendly copy", () => {
    expect(friendlyAuthError({ message: "Invalid login credentials" })).toBe(
      "Incorrect email or password."
    );
  });

  it("maps a duplicate-email error", () => {
    expect(friendlyAuthError({ message: "User already registered" })).toBe(
      "An account with this email already exists."
    );
  });

  it("maps an unconfirmed-email error", () => {
    expect(
      friendlyAuthError({ message: "Email not confirmed" })
    ).toContain("confirm your email");
  });

  it("maps rate-limiting", () => {
    expect(
      friendlyAuthError({ message: "Request rate limit reached" })
    ).toContain("Too many attempts");
  });

  it("passes an unrecognised message through unchanged", () => {
    expect(friendlyAuthError({ message: "Some weird error" })).toBe(
      "Some weird error"
    );
  });

  it("returns the fallback for null / blank input", () => {
    const fallback = "Something went wrong. Please try again.";
    expect(friendlyAuthError(null)).toBe(fallback);
    expect(friendlyAuthError({ message: "   " })).toBe(fallback);
  });
});
