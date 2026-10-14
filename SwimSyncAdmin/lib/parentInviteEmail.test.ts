import { describe, it, expect, vi, afterEach } from "vitest";
import {
  buildParentInviteSubject,
  buildParentInviteHtml,
  sendParentInviteEmail,
} from "./parentInviteEmail";

const base = {
  businessName: "Dolphin Swim Academy",
  studentName: "Ethan Tan",
  actionLink: "https://example.test/verify?token=abc&type=invite",
};

describe("buildParentInviteSubject", () => {
  // PRD §7.10: the parent knows their coach, not SwimSync. A subject headed
  // "SwimSync" gives no clue who is asking — worse here than on an invoice,
  // because the recipient has never heard of the platform.
  it("is headed by the BUSINESS, not SwimSync", () => {
    expect(buildParentInviteSubject(base)).toBe(
      "Dolphin Swim Academy has set up your SwimSync account"
    );
  });

  it("falls back when the business name is blank", () => {
    expect(buildParentInviteSubject({ ...base, businessName: "  " })).toBe(
      "Your SwimSync account is ready"
    );
  });
});

describe("buildParentInviteHtml", () => {
  it("embeds the action link, the business and the child", () => {
    const html = buildParentInviteHtml(base);
    // The `&` is entity-escaped because the link sits in an href attribute —
    // the same assertion inviteEmail.test.ts makes, for the same reason.
    expect(html).toContain(
      'href="https://example.test/verify?token=abc&amp;type=invite"'
    );
    expect(html).toContain("Dolphin Swim Academy");
    // Naming the child is the proof this is not spam: the parent recognises
    // their own child; a stranger's link would name someone they don't know.
    expect(html).toContain("Ethan Tan");
  });

  it("states how many lessons are already recorded, so a first invoice is no surprise", () => {
    const html = buildParentInviteHtml({ ...base, lessonsRecorded: 6 });
    expect(html).toContain("6");
    expect(html).toContain("lessons");
  });

  it("says nothing about lessons when there are none", () => {
    const html = buildParentInviteHtml({ ...base, lessonsRecorded: 0 });
    expect(html).not.toContain("already been recorded");
  });

  it("uses the singular for exactly one lesson", () => {
    const html = buildParentInviteHtml({ ...base, lessonsRecorded: 1 });
    expect(html).toContain("1</strong> lesson has");
  });

  it("escapes HTML in names so a quote cannot break the markup", () => {
    const html = buildParentInviteHtml({
      ...base,
      businessName: 'Bob & "Co" <Swim>',
      studentName: "<script>x</script>",
    });
    expect(html).toContain("Bob &amp; &quot;Co&quot; &lt;Swim&gt;");
    expect(html).not.toContain("<script>");
  });
});

describe("sendParentInviteEmail", () => {
  afterEach(() => vi.unstubAllGlobals());

  // Local dev and tests must never send. Unlike an invoice email the CALLER
  // must surface this rather than swallowing it: an invite nobody receives
  // means the parent never gets an account and their child's lessons keep
  // holding the billing month open.
  it("is a no-op without an API key, and says why", async () => {
    const res = await sendParentInviteEmail({ ...base, apiKey: undefined, to: "p@test" });
    expect(res).toEqual({ sent: false, reason: "no_api_key" });
  });

  it("refuses quietly with no recipient", async () => {
    const res = await sendParentInviteEmail({ ...base, apiKey: "k", to: null });
    expect(res).toEqual({ sent: false, reason: "no_recipient" });
  });

  it("reports success when Resend accepts it", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true }));
    const res = await sendParentInviteEmail({ ...base, apiKey: "k", to: "p@test" });
    expect(res).toEqual({ sent: true });
  });

  it("reports the status when Resend rejects it", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 422 }));
    const res = await sendParentInviteEmail({ ...base, apiKey: "k", to: "p@test" });
    expect(res).toEqual({ sent: false, reason: "resend_422" });
  });

  // It reports, it never throws — a network failure must not become a 500 on
  // the invite route after the child has already been linked.
  it("never throws on a network failure", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("boom")));
    const res = await sendParentInviteEmail({ ...base, apiKey: "k", to: "p@test" });
    expect(res).toEqual({ sent: false, reason: "boom" });
  });
});

// ── Email-safe rendering (UI restyle Phase 6, ⚠ RISK 7) ────────────────────
// The invite IS the deliverable: every variant carries the link and the business
// name, in inline CSS only, with a Geist family that falls back to a system font
// (mail clients never load Geist).
const BANNED_IN_EMAIL = ["var(", "display:flex", "display:grid", "<link", "@font-face", "@import", "<style"];

function expectEmailSafe(html: string, mustContain: string[]) {
  for (const s of mustContain) expect(html).toContain(s);
  for (const b of BANNED_IN_EMAIL) expect(html).not.toContain(b);
  const families = [...html.matchAll(/font-family:([^;"]+)/g)].map((m) => m[1]);
  expect(families.length).toBeGreaterThan(0);
  for (const f of families) {
    expect(f.startsWith("Geist,"), `font-family must start with Geist: ${f}`).toBe(true);
    expect(/sans-serif\s*$/.test(f), `font-family must end in a system fallback: ${f}`).toBe(true);
  }
}

describe("parent invite email is email-safe (Phase 6)", () => {
  it("with and without recorded lessons; headed by the business", () => {
    for (const d of [base, { ...base, lessonsRecorded: 1 }, { ...base, lessonsRecorded: 6 }]) {
      const html = buildParentInviteHtml(d);
      expectEmailSafe(html, ["href=\"https://example.test/verify?token=abc&amp;type=invite\"", "Dolphin Swim Academy"]);
      expect(html.slice(0, html.indexOf("<h1"))).not.toContain("SwimSync");
    }
  });
});
