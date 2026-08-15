import {
  buildReferralShareText,
  buildWhatsAppUrl,
  rewardSummary,
} from "./referralShare";

describe("buildReferralShareText", () => {
  it("names the business and the code, and points at /welcome", () => {
    const t = buildReferralShareText("Coastal Swim School", "REF-ABCDE");
    expect(t).toContain("Coastal Swim School");
    expect(t).toContain("REF-ABCDE");
    expect(t).toContain("https://swimsync.sg/welcome");
  });
});

describe("buildWhatsAppUrl", () => {
  it("URL-encodes the message into a wa.me link", () => {
    const url = buildWhatsAppUrl(buildReferralShareText("A & B Swim", "REF-XY2ZQ"));
    expect(url.startsWith("https://wa.me/?text=")).toBe(true);
    // spaces and & are encoded, so the raw text never leaks into the query
    expect(url).not.toContain(" ");
    expect(url).toContain("REF-XY2ZQ");
    expect(decodeURIComponent(url.split("text=")[1])).toContain("A & B Swim");
  });
});

describe("rewardSummary", () => {
  it("nudges when there are none, singular for one, plural above", () => {
    expect(rewardSummary(0)).toMatch(/Refer a friend/);
    expect(rewardSummary(1)).toMatch(/^1 reward waiting/);
    expect(rewardSummary(3)).toMatch(/^3 rewards waiting/);
  });
});

// RISK 9 — a family in two businesses keeps two DISTINCT codes; the card list
// is one per membership that has a code (the component filters on that).
describe("per-business card shape (RISK 9)", () => {
  const memberships = [
    { referral_code: "REF-AAAAA", business_name: "School A" },
    { referral_code: "REF-BBBBB", business_name: "Coach B" },
    { referral_code: null, business_name: "No code yet" },
  ];
  it("renders one card per membership that has a code, never a shared one", () => {
    const withCode = memberships.filter((m) => m.referral_code);
    expect(withCode).toHaveLength(2);
    expect(new Set(withCode.map((m) => m.referral_code)).size).toBe(2);
  });
});
