// DESIGN.md → Status scale, the parent/coach side: the word → tone mapping in
// lib/statusTone.ts, as the badge renders it through components/ui/Tag. The admin
// twin's statusTone.test.ts pins both copies identical.
import React from "react";
import { render, screen } from "@testing-library/react-native";
import StatusBadge from "./StatusBadge";

const textClass = (word: string) => String(screen.getByText(word).props.className);
const boxClass = (word: string) => String(screen.getByText(word).parent?.parent?.props.className ?? "");

describe("StatusBadge", () => {
  it("an unpaid invoice is amber (Due), never red — red means stuck", () => {
    render(<StatusBadge status="Outstanding" />);
    expect(textClass("Outstanding")).toContain("text-status-warning-text");
    expect(textClass("Outstanding")).not.toContain("danger");
  });

  it("paid is green, pending is info blue", () => {
    render(<><StatusBadge status="Paid" /><StatusBadge status="Pending" /></>);
    expect(textClass("Paid")).toContain("text-status-success-text");
    expect(textClass("Pending")).toContain("text-status-info-text");
  });

  it("is a 4px bordered tag, not a pill", () => {
    render(<StatusBadge status="Paid" />);
    const box = boxClass("Paid");
    expect(box).toMatch(/\brounded-tag\b/);
    expect(box).not.toContain("rounded-full");
    expect(box).toMatch(/\bborder\b/);
  });

  it("Not Marked still reads as a dash", () => {
    render(<StatusBadge status="Not Marked" />);
    expect(screen.getByText("–")).toBeTruthy();
  });
});
