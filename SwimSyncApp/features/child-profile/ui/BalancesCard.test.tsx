// BalancesCard — the child profile's Outstanding / Credit Balance boxes and the
// "how this child's lessons are paid" coverage line. Pinned: each box shows
// exactly its own amount (distinct fixture values, read from inside the box its
// label sits in), both boxes render even at S$0.00, and the coverage line is
// describeCoverage's exact copy for every verdict — absent when coverage is
// unknown (the RPC failed).
//
// MUTATION PROOFS (§7.25) — applied through mutate.sh (restores from HEAD on exit):
//   BalancesCard.tsx
//   1. `S${child.outstanding_amount.toFixed(2)}` → `S${child.credit_balance.toFixed(2)}`
//      → RED: "each box shows exactly its own amount"
//   2. `S${child.credit_balance.toFixed(2)}` → `S${child.outstanding_amount.toFixed(2)}`
//      → RED: "each box shows exactly its own amount"
//   3. Outstanding amount hidden at zero (`{child.outstanding_amount > 0 ? … : null}`)
//      → RED: "S$0.00 outstanding still renders both boxes"
//   lib/packageCoverage.ts (describeCoverage — the copy this card shows)
//   4. `shared across the family` → `shared with the family`
//      → RED: "package coverage with 1 lesson left"
//   5. `some classes bill per lesson` → `some classes billed per lesson`
//      → RED: "mixed coverage with 3 lessons left"
//   6. `"Ad-hoc — billed per lesson"` → `"Ad hoc — billed per lesson"`
//      → RED: "ad-hoc coverage"
//   7. `if (!c) return null;` → `if (!c) return "Ad-hoc — billed per lesson";`
//      → RED: "unknown coverage renders no coverage line"
import React from "react";
import { render, screen, within } from "@testing-library/react-native";
import { BalancesCard } from "./BalancesCard";
import type { ChildDetail } from "../types";
import type { StudentCoverage } from "@/lib/packageCoverage";

type ReactTestInstance = ReturnType<typeof screen.getByText>;

function child(over: Partial<ChildDetail> = {}): ChildDetail {
  return {
    id: "kid-A",
    full_name: "Anna Tan",
    date_of_birth: null,
    gender: null,
    level_label: null,
    level_note: null,
    level_skills: [],
    skill_grades: {},
    scale: [],
    notes: null,
    assignment_status: "assigned",
    is_active: true,
    classes: [],
    outstanding_amount: 120,
    credit_balance: 35.5,
    ...over,
  };
}

function cov(coverage: StudentCoverage["coverage"], lessonsRemaining: number | null): StudentCoverage {
  return { parentId: "parent-1", tenantId: "tA", coverage, lessonsRemaining };
}

/** The n-th HOST ancestor of an element (composite wrappers skipped). */
function hostAncestor(el: ReactTestInstance, n: number): ReactTestInstance {
  let node = el;
  while (n > 0) {
    node = node.parent!;
    if (typeof node.type === "string") n--;
  }
  return node;
}

/** The box a label sits in: label Text → its box View. */
function boxOf(label: string) {
  return within(hostAncestor(screen.getByText(label), 1));
}

const COVERAGE_COPY = /lesson|Ad-hoc|Package|Mixed/;

describe("BalancesCard", () => {
  it("each box shows exactly its own amount", () => {
    render(<BalancesCard child={child()} coverage={undefined} />);
    expect(boxOf("Outstanding").getByText("S$120.00")).toBeTruthy();
    expect(boxOf("Outstanding").queryByText("S$35.50")).toBeNull();
    expect(boxOf("Credit Balance").getByText("S$35.50")).toBeTruthy();
    expect(boxOf("Credit Balance").queryByText("S$120.00")).toBeNull();
  });

  it("S$0.00 outstanding still renders both boxes", () => {
    render(<BalancesCard child={child({ outstanding_amount: 0 })} coverage={undefined} />);
    expect(boxOf("Outstanding").getByText("S$0.00")).toBeTruthy();
    expect(boxOf("Credit Balance").getByText("S$35.50")).toBeTruthy();
  });

  it("package coverage with 1 lesson left", () => {
    render(<BalancesCard child={child()} coverage={cov("package", 1)} />);
    expect(screen.getByText("Package — 1 lesson left · shared across the family")).toBeTruthy();
  });

  it("mixed coverage with 3 lessons left", () => {
    render(<BalancesCard child={child()} coverage={cov("mixed", 3)} />);
    expect(screen.getByText("Mixed — 3 lessons left · some classes bill per lesson")).toBeTruthy();
  });

  it("ad-hoc coverage", () => {
    render(<BalancesCard child={child()} coverage={cov("ad_hoc", null)} />);
    expect(screen.getByText("Ad-hoc — billed per lesson")).toBeTruthy();
  });

  it("unknown coverage renders no coverage line", () => {
    render(<BalancesCard child={child()} coverage={undefined} />);
    expect(screen.queryByText(COVERAGE_COPY)).toBeNull();
  });
});
