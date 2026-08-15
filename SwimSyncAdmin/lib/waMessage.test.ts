import { describe, it, expect } from "vitest";
import {
  buildPackageOfferMessage,
  buildReminderMessage,
  buildWaLink,
  monthLabel,
  toWaNumber,
} from "./waMessage";

describe("buildPackageOfferMessage", () => {
  const base = {
    businessName: "Coastal Swim",
    childrenNames: ["Ali", "Bo"],
    packageName: "8 Group Lessons",
    lessons: 8,
    price: 320,
    reference: "PKG-2026-0001",
    link: "https://swimsync.sg/package/deadbeef",
  };
  it("names the business, package, children, price, ref and link", () => {
    const m = buildPackageOfferMessage(base);
    expect(m).toContain("Coastal Swim");
    expect(m).toContain("8 Group Lessons");
    expect(m).toContain("Ali, Bo");
    expect(m).toContain("$320.00");
    expect(m).toContain("PKG-2026-0001");
    expect(m).toContain("https://swimsync.sg/package/deadbeef");
  });
  it("falls back to 'your child' with no names", () => {
    expect(buildPackageOfferMessage({ ...base, childrenNames: [] })).toContain(
      "your child"
    );
  });
});

describe("toWaNumber", () => {
  it("prefixes 65 onto a bare 8-digit number", () => {
    expect(toWaNumber("91234567")).toBe("6591234567");
  });

  it("normalizes +65 / spaced forms via normalizeSgPhone", () => {
    expect(toWaNumber("+65 9123 4567")).toBe("6591234567");
    expect(toWaNumber("6591234567")).toBe("6591234567");
  });

  it("returns null for anything that cannot carry a chat — the UI shows 'no number', never a broken link", () => {
    expect(toWaNumber(null)).toBeNull();
    expect(toWaNumber(undefined)).toBeNull();
    expect(toWaNumber("")).toBeNull();
    expect(toWaNumber("12345")).toBeNull();
    expect(toWaNumber("not a phone")).toBeNull();
  });
});

describe("monthLabel", () => {
  it("renders YYYY-MM as a human month", () => {
    expect(monthLabel("2026-07")).toBe("July 2026");
    expect(monthLabel("2025-12")).toBe("December 2025");
  });

  it("falls back to the raw string rather than inventing a date", () => {
    expect(monthLabel("garbage")).toBe("garbage");
    expect(monthLabel("2026-13")).toBe("2026-13");
  });
});

describe("buildReminderMessage", () => {
  const base = {
    businessName: "Coach Marcus Swim School",
    studentNames: ["Alice", "Ben"],
    billingMonth: "2026-07",
    amount: 300,
    link: "https://swimsync.sg/invoice/abc123",
    reference: "INV-2026-0001",
  };

  it("interpolates every field of the fixed template", () => {
    const msg = buildReminderMessage(base);
    expect(msg).toContain("Coach Marcus Swim School");
    expect(msg).toContain("Alice, Ben");
    expect(msg).toContain("July 2026");
    expect(msg).toContain("$300.00");
    expect(msg).toContain("INV-2026-0001");
    expect(msg).toContain("https://swimsync.sg/invoice/abc123");
  });

  it("survives an empty student list without reading like a mail merge gone wrong", () => {
    expect(buildReminderMessage({ ...base, studentNames: [] })).toContain(
      "Invoice for your child",
    );
  });
});

describe("buildWaLink", () => {
  it("URL-encodes the message — newlines, $, and & all survive WhatsApp's parser", () => {
    const link = buildWaLink("6591234567", "Pay $5 & smile\nnow");
    expect(link).toBe(
      "https://wa.me/6591234567?text=Pay%20%245%20%26%20smile%0Anow",
    );
  });

  it("composes with the template end to end", () => {
    const msg = buildReminderMessage({
      businessName: "X",
      studentNames: ["A"],
      billingMonth: "2026-07",
      amount: 10,
      link: "https://swimsync.sg/invoice/t",
      reference: "INV-2026-0002",
    });
    const link = buildWaLink("6591234567", msg);
    expect(link.startsWith("https://wa.me/6591234567?text=")).toBe(true);
    expect(decodeURIComponent(link.split("?text=")[1])).toBe(msg);
  });
});
