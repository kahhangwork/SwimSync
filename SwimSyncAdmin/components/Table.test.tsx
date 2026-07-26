import { describe, it, expect } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { Table, Thead, Th, Tbody, Tr, Td, useTableSort } from "./Table";

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
 * See `docs/GOTCHAS.md` §7.54.
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
              `See docs/GOTCHAS.md §7.54.`
          );
        }
      });
    }

    expect(offenders).toEqual([]);
  });
});

describe("a sortable column", () => {
  type Row = { name: string; count: number };

  const rows: Row[] = [
    { name: "Ruhaan", count: 1 },
    { name: "aadi", count: 3 },
    { name: "Neel", count: 2 },
  ];

  function Harness({ initialKey }: { initialKey?: string | null }) {
    const sort = useTableSort<Row>({ key: initialKey ?? null });
    const visible = sort.apply(rows);
    return (
      <Table>
        <Thead>
          <Th sort={sort} sortKey="name">
            Student
          </Th>
          <Th sort={sort} sortKey="count" firstDir="desc">
            Lessons
          </Th>
          <Th>Actions</Th>
        </Thead>
        <Tbody>
          {visible.map((r) => (
            <Tr key={r.name}>
              <Td>{r.name}</Td>
              <Td>{r.count}</Td>
              <Td>—</Td>
            </Tr>
          ))}
        </Tbody>
      </Table>
    );
  }

  const names = () =>
    Array.from(document.querySelectorAll("tbody tr td:first-child")).map(
      (td) => td.textContent
    );

  it("leaves the page's own order alone until a column is clicked", () => {
    // The pages already order their queries — newest invoice, oldest request
    // first. A table that re-sorted itself on mount would silently override the
    // order the page deliberately asked the database for.
    render(<Harness />);
    expect(names()).toEqual(["Ruhaan", "aadi", "Neel"]);
  });

  it("sorts on click, and reverses on a second click", () => {
    render(<Harness />);
    const header = screen.getByRole("button", { name: /Student/ });

    fireEvent.click(header);
    expect(names()).toEqual(["aadi", "Neel", "Ruhaan"]);

    fireEvent.click(header);
    expect(names()).toEqual(["Ruhaan", "Neel", "aadi"]);
  });

  it("honours firstDir, so a count column opens on its largest value", () => {
    render(<Harness />);
    fireEvent.click(screen.getByRole("button", { name: /Lessons/ }));
    expect(names()).toEqual(["aadi", "Neel", "Ruhaan"]); // counts 3, 2, 1
  });

  it("reports direction to screen readers via aria-sort", () => {
    render(<Harness />);
    const th = () => screen.getByRole("columnheader", { name: /Student/ });

    // Sortable but inactive is "none", NOT absent — absent means "not sortable",
    // and the arrow is the only other signal that the column can be clicked.
    expect(th().getAttribute("aria-sort")).toBe("none");

    fireEvent.click(screen.getByRole("button", { name: /Student/ }));
    expect(th().getAttribute("aria-sort")).toBe("ascending");

    fireEvent.click(screen.getByRole("button", { name: /Student/ }));
    expect(th().getAttribute("aria-sort")).toBe("descending");
  });

  it("gives a non-sortable column no button and no aria-sort", () => {
    render(<Harness />);
    const actions = screen.getByRole("columnheader", { name: "Actions" });
    expect(actions.getAttribute("aria-sort")).toBeNull();
    expect(actions.querySelector("button")).toBeNull();
  });

  it("makes every column hug its content", () => {
    render(<Harness />);
    // `w-px` + `nowrap` is the mechanism: a width that small cannot be honoured,
    // so the column falls back to min-content — and with no wrapping allowed,
    // min-content IS the full text.
    for (const th of Array.from(document.querySelectorAll("thead th"))) {
      expect(th.className).toContain("w-px");
      expect(th.className).toContain("whitespace-nowrap");
    }
  });

  it("gives the last column the leftover width, from the table itself", () => {
    // The rule is one descendant selector on the <table>, not a prop each table
    // has to remember — so it cannot be forgotten, and there is no call-site
    // scan to keep honest. A `grow` prop version needed one, and still put the
    // gap mid-table on Attendance.
    render(<Harness />);
    const table = document.querySelector("table") as HTMLElement;
    expect(table.className).toContain("[&_th:last-child]:w-full");
    expect(table.className).toContain("[&_td:last-child]:w-full");
  });

  it("caps a `wrap` column instead of letting it push the table sideways", () => {
    const { container } = render(
      <table>
        <Thead>
          <Th wrap>Reason</Th>
        </Thead>
      </table>
    );
    const prose = container.querySelector("th") as HTMLElement;
    expect(prose.className).toContain("whitespace-normal");
    expect(prose.className).toContain("max-w-xs");
    expect(prose.className).not.toContain("whitespace-nowrap");
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
