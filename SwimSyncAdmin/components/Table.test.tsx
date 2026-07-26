import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { Table, Thead, Th, Tbody, Tr, Td } from "./Table";

/**
 * THE CONTRACT: <Thead> OWNS ITS <tr>. CALLERS PASS <Th> DIRECTLY.
 *
 * This file exists because prose could not enforce that. Commit 42803db made
 * Thead emit its own <tr>, swept the call sites, MISSED ONE, and left a
 * docblock claiming the broken form was now "unrepresentable". It was not:
 * levels/page.tsx kept its <Tr>, rendered a <tr> inside a <tr>, and shipped a
 * visibly broken table to production for a week with nothing going red.
 *
 * A comment describing a call-site contract is a wish. This is the contract.
 * See HANDOVER §7.54.
 */

function adminPages(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...adminPages(full));
    else if (entry === "page.tsx") out.push(full);
  }
  return out;
}

describe("Thead owns its <tr> — call-site scan", () => {
  it("no admin page wraps its <Th>s in a <Tr>", () => {
    const pages = adminPages(join(process.cwd(), "app", "(admin)"));

    // Guards the guard: if the walk ever returns nothing — a moved directory,
    // a renamed route group — every assertion below passes vacuously and the
    // contract quietly stops being enforced.
    expect(pages.length).toBeGreaterThan(10);

    const offenders: string[] = [];
    for (const file of pages) {
      const src = readFileSync(file, "utf8");
      const blocks = src.match(/<Thead>[\s\S]*?<\/Thead>/g) ?? [];
      blocks.forEach((block, i) => {
        // `<Tr` and not `<Tr>` on purpose — `<Tr className="…">` is the same
        // bug wearing a prop, and matching the closing bracket would miss it.
        if (block.includes("<Tr")) {
          const rel = file.slice(file.indexOf("app/"));
          offenders.push(
            `${rel}: <Thead> block ${i + 1} contains a <Tr>. Thead emits its ` +
              `own <tr>, so this renders <tr> inside <tr> and the header ` +
              `collapses into one column. Delete the <Tr> wrapper and pass ` +
              `<Th> directly. A table that genuinely needs a SECOND header ` +
              `row needs its own component — do not loosen this test. ` +
              `See HANDOVER §7.54.`
          );
        }
      });
    }

    expect(offenders).toEqual([]);
  });
});

describe("Thead renders one row", () => {
  it("emits exactly one <tr>, so callers must not add their own", () => {
    const { container } = render(
      <table>
        <Thead>
          <Th>Order</Th>
          <Th>Level</Th>
        </Thead>
      </table>
    );
    expect(container.querySelectorAll("thead tr")).toHaveLength(1);
    expect(container.querySelectorAll("thead tr tr")).toHaveLength(0);
    expect(container.querySelectorAll("thead th")).toHaveLength(2);
  });

  it("a body row's cells are direct children of its <tr>", () => {
    const { container } = render(
      <Table>
        <Tbody>
          <Tr>
            <Td>a</Td>
            <Td>b</Td>
          </Tr>
        </Tbody>
      </Table>
    );
    expect(container.querySelectorAll("tbody tr")).toHaveLength(1);
    expect(container.querySelectorAll("tbody tr > td")).toHaveLength(2);
  });
});
