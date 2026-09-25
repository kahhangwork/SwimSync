import fs from "node:fs";
import path from "node:path";
import { allowsNoSession, isPublicPage } from "./publicRoutes";

describe("allowsNoSession — what a signed-out load may open", () => {
  // The coach sends a new family swimsync.sg/register; it used to bounce to
  // Sign In (BACKLOG, found by verify-smoke-app 2026-09-13).
  it.each(["/register", "/forgot-password", "/register/"])("opens %s", (p) => {
    expect(allowsNoSession(p)).toBe(true);
  });

  it.each(["/welcome", "/invoice/abc123", "/package/abc123"])("still opens the public page %s", (p) => {
    expect(allowsNoSession(p)).toBe(true);
  });

  // The token screens need the recovery/invite session; the layout routes to
  // them on the URL's #type flag. Opening them bare would show a form that
  // cannot work.
  it.each(["/reset-password", "/accept-invite"])("keeps %s gated", (p) => {
    expect(allowsNoSession(p)).toBe(false);
  });

  // Exact match: a prefix must not smuggle anything else through.
  it.each(["/registered", "/register-admin", "/register/x", "/forgot-password-2"])(
    "does not match %s by prefix",
    (p) => {
      expect(allowsNoSession(p)).toBe(false);
    }
  );

  it.each(["/", "/login", "/home", "/schedule", "/billing/invoice/x"])("gates %s", (p) => {
    expect(allowsNoSession(p)).toBe(false);
  });
});

describe("isPublicPage — what a signed-in user stays on", () => {
  it("keeps a signed-in user on their invoice link", () => {
    expect(isPublicPage("/invoice/abc123")).toBe(true);
  });

  // Like /login: a signed-in user opening Register is sent to their landing,
  // not shown a sign-up form.
  it.each(["/register", "/forgot-password", "/login"])("does not keep a signed-in user on %s", (p) => {
    expect(isPublicPage(p)).toBe(false);
  });
});

describe("the screens it names exist", () => {
  // A renamed screen would silently drop out of the allowance.
  it.each(["register", "forgot-password"])("app/(auth)/%s.tsx", (name) => {
    expect(fs.existsSync(path.join(__dirname, "..", "app", "(auth)", `${name}.tsx`))).toBe(true);
  });
});
