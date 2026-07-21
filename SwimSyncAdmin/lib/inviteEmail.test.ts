import { describe, it, expect, vi, afterEach } from "vitest";
import {
  buildInviteEmailSubject,
  buildInviteEmailHtml,
  sendInviteEmail,
} from "./inviteEmail";

const base = {
  adminName: "Marcus Tan",
  businessName: "Dolphin Swim Academy",
  actionLink: "https://example.test/verify?token=abc&type=invite",
};

describe("buildInviteEmailSubject", () => {
  it("names the business", () => {
    expect(buildInviteEmailSubject(base)).toBe(
      "Set up Dolphin Swim Academy on SwimSync"
    );
  });

  it("falls back when the business name is blank", () => {
    expect(buildInviteEmailSubject({ ...base, businessName: "   " })).toBe(
      "Set up your business on SwimSync"
    );
  });
});

describe("buildInviteEmailHtml", () => {
  it("embeds the action link and the business name", () => {
    const html = buildInviteEmailHtml(base);
    expect(html).toContain("Dolphin Swim Academy");
    expect(html).toContain("Set your password");
    // The & in the query string must be escaped inside the href attribute.
    expect(html).toContain(
      'href="https://example.test/verify?token=abc&amp;type=invite"'
    );
  });

  it("shows the join code when given, and omits that block otherwise", () => {
    expect(buildInviteEmailHtml({ ...base, joinCode: "SWIM-4821" })).toContain(
      "SWIM-4821"
    );
    expect(buildInviteEmailHtml(base)).not.toContain("join code is");
  });

  it("escapes HTML in the business name so a quote cannot break the markup", () => {
    const html = buildInviteEmailHtml({
      ...base,
      businessName: '<script>alert("x")</script>',
    });
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
  });

  it("greets 'there' rather than an empty space when the name is missing", () => {
    expect(buildInviteEmailHtml({ ...base, adminName: "" })).toContain(
      "Hi there,"
    );
  });

  it("is SwimSync-branded, not business-branded", () => {
    // Deliberately the inverse of the invoice email (PRD §7.10): the platform
    // is inviting someone to a business they do not know yet.
    const html = buildInviteEmailHtml(base);
    expect(html).toContain(">SwimSync<");
    expect(html).toContain("Sent by SwimSync");
  });
});

describe("sendInviteEmail", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("no-ops without an API key — and reports it rather than claiming success", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const r = await sendInviteEmail({
      ...base,
      apiKey: undefined,
      to: "owner@test.local",
    });
    expect(r).toEqual({ sent: false, reason: "no_api_key" });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("no-ops without a recipient", async () => {
    const r = await sendInviteEmail({ ...base, apiKey: "k", to: null });
    expect(r).toEqual({ sent: false, reason: "no_recipient" });
  });

  it("posts to Resend and reports success", async () => {
    const fetchSpy = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal("fetch", fetchSpy);
    const r = await sendInviteEmail({
      ...base,
      apiKey: "key-123",
      to: "owner@test.local",
    });
    expect(r).toEqual({ sent: true });
    const [url, init] = fetchSpy.mock.calls[0];
    expect(url).toBe("https://api.resend.com/emails");
    expect(init.headers.Authorization).toBe("Bearer key-123");
    const body = JSON.parse(init.body);
    expect(body.to).toBe("owner@test.local");
    expect(body.subject).toContain("Dolphin Swim Academy");
  });

  it("reports a non-OK Resend response instead of throwing", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 422,
        text: async () => "bad address",
      })
    );
    const r = await sendInviteEmail({
      ...base,
      apiKey: "k",
      to: "owner@test.local",
    });
    expect(r.sent).toBe(false);
    expect(r.reason).toContain("resend_422");
  });

  it("reports a network failure instead of throwing", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
    const r = await sendInviteEmail({
      ...base,
      apiKey: "k",
      to: "owner@test.local",
    });
    expect(r.sent).toBe(false);
    expect(r.reason).toContain("fetch_error");
  });
});
