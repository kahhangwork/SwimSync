import { describe, it, expect, vi, afterEach } from "vitest";
import {
  buildCoAdminInviteEmailSubject,
  buildCoAdminInviteEmailHtml,
  sendCoAdminInviteEmail,
} from "./coAdminInviteEmail";

const base = {
  adminName: "Priya Nair",
  businessName: "Dolphin Swim Academy",
  actionLink: "https://example.test/verify?token=abc&type=invite",
};

describe("buildCoAdminInviteEmailSubject", () => {
  it("names the business, as staff — not as a handover", () => {
    expect(buildCoAdminInviteEmailSubject(base)).toBe(
      "Help manage Dolphin Swim Academy on SwimSync"
    );
  });

  it("falls back when the business name is blank", () => {
    expect(buildCoAdminInviteEmailSubject({ ...base, businessName: "  " })).toBe(
      "Help manage a business on SwimSync"
    );
  });
});

describe("buildCoAdminInviteEmailHtml", () => {
  it("embeds the action link and the business name", () => {
    const html = buildCoAdminInviteEmailHtml(base);
    expect(html).toContain("Dolphin Swim Academy");
    expect(html).toContain("Set your password");
    // The & in the query string must be escaped inside the href attribute.
    expect(html).toContain(
      'href="https://example.test/verify?token=abc&amp;type=invite"'
    );
  });

  it("says help manage, never the owner email's ownership copy", () => {
    const html = buildCoAdminInviteEmailHtml(base);
    expect(html).toContain("help manage");
    expect(html).not.toContain("to run");
  });

  it("carries NO join-code copy — that is credential custody, and it belongs to the owner", () => {
    // The owner invite shows the code with "you can find and change it any
    // time" — proprietor language. A co-admin sees the code on the dashboard
    // once they are in; it is deliberately not mailed to them.
    const html = buildCoAdminInviteEmailHtml(base);
    expect(html).not.toContain("join code");
    expect(html).not.toContain("Your join code is");
  });

  it("escapes HTML in the business name so a quote cannot break the markup", () => {
    const html = buildCoAdminInviteEmailHtml({
      ...base,
      businessName: '<script>alert("x")</script>',
    });
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
  });

  it("greets 'there' rather than an empty space when the name is missing", () => {
    expect(buildCoAdminInviteEmailHtml({ ...base, adminName: "" })).toContain(
      "Hi there,"
    );
  });

  it("points an expired link at the business owner, not at SwimSync", () => {
    // The owner's invite says "ask your SwimSync contact"; a co-admin's
    // re-invite button is on the OWNER's Admins page.
    const html = buildCoAdminInviteEmailHtml(base).replace(/\s+/g, " ");
    expect(html).toContain("ask the business owner");
    expect(html).not.toContain("SwimSync contact");
  });
});

describe("sendCoAdminInviteEmail", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("no-ops without an API key — and reports it rather than claiming success", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const r = await sendCoAdminInviteEmail({
      ...base,
      apiKey: undefined,
      to: "coadmin@test.local",
    });
    expect(r).toEqual({ sent: false, reason: "no_api_key" });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("no-ops without a recipient", async () => {
    const r = await sendCoAdminInviteEmail({ ...base, apiKey: "k", to: null });
    expect(r).toEqual({ sent: false, reason: "no_recipient" });
  });

  it("posts to Resend and reports success", async () => {
    const fetchSpy = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal("fetch", fetchSpy);
    const r = await sendCoAdminInviteEmail({
      ...base,
      apiKey: "key-123",
      to: "coadmin@test.local",
    });
    expect(r).toEqual({ sent: true });
    const [url, init] = fetchSpy.mock.calls[0];
    expect(url).toBe("https://api.resend.com/emails");
    expect(init.headers.Authorization).toBe("Bearer key-123");
    const body = JSON.parse(init.body);
    expect(body.to).toBe("coadmin@test.local");
    expect(body.subject).toContain("Help manage Dolphin Swim Academy");
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
    const r = await sendCoAdminInviteEmail({
      ...base,
      apiKey: "k",
      to: "coadmin@test.local",
    });
    expect(r.sent).toBe(false);
    expect(r.reason).toContain("resend_422");
  });

  it("reports a network failure instead of throwing", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
    const r = await sendCoAdminInviteEmail({
      ...base,
      apiKey: "k",
      to: "coadmin@test.local",
    });
    expect(r.sent).toBe(false);
    expect(r.reason).toContain("fetch_error");
  });
});
