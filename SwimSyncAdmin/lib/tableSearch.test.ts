import { describe, it, expect } from "vitest";
import {
  ilikeContains,
  orIlike,
  matchesAnyField,
  type SearchFieldMatcher,
} from "./tableSearch";

describe("ilikeContains — the injection-safe `.ilike(col, pattern)` argument", () => {
  it("wraps a plain term for a case-insensitive substring match", () => {
    expect(ilikeContains("anya")).toBe("%anya%");
  });

  it("trims surrounding whitespace so a stray space is not part of the match", () => {
    expect(ilikeContains("  tan  ")).toBe("%tan%");
  });

  it("escapes the LIKE wildcards so a literal % or _ matches itself, not everything", () => {
    // A parent who types "50%" means the three characters, not "5, 0, anything".
    expect(ilikeContains("50%")).toBe("%50\\%%");
    expect(ilikeContains("a_b")).toBe("%a\\_b%");
  });

  it("escapes a backslash so it cannot start an escape sequence of its own", () => {
    expect(ilikeContains("a\\b")).toBe("%a\\\\b%");
  });
});

describe("orIlike — the `.or()` string for a field spanning several columns", () => {
  it("matches the term against every column, case-insensitively", () => {
    expect(orIlike(["full_name", "email"], "tan")).toBe(
      'full_name.ilike."*tan*",email.ilike."*tan*"',
    );
  });

  // The load-bearing safety property: a name containing PostgREST's or-grammar
  // punctuation (a comma, brackets) must NOT be able to change the query. The
  // value is double-quoted and its quotes/backslashes escaped, so `, ( )` inside
  // it are literal, never structural.
  it("neutralises a comma so it cannot start a second or-condition", () => {
    const out = orIlike(["full_name"], "tan, marcus");
    // The comma sits INSIDE the quoted value — there is exactly one condition.
    expect(out).toBe('full_name.ilike."*tan, marcus*"');
    // And it never appears as a bare (unquoted) separator.
    expect(out.split('"').length).toBe(3); // opening + closing quote only
  });

  it("neutralises brackets so they cannot open a grouping", () => {
    expect(orIlike(["full_name"], "a(b)c")).toBe('full_name.ilike."*a(b)c*"');
  });

  it("escapes a double-quote in the term so it cannot close the value early", () => {
    expect(orIlike(["full_name"], 'a"b')).toBe('full_name.ilike."*a\\"b*"');
  });

  it("escapes a backslash in the term", () => {
    expect(orIlike(["full_name"], "a\\b")).toBe('full_name.ilike."*a\\\\b*"');
  });

  it("escapes the wildcard so a literal * or % matches itself", () => {
    // The backslash is DOUBLED so it survives PostgREST's quoted-value
    // unescaping and reaches SQL ILIKE as a literal — verified against the live
    // DB (a single backslash matched every row). See orValue in tableSearch.ts.
    expect(orIlike(["full_name"], "a*b")).toBe('full_name.ilike."*a\\\\*b*"');
    expect(orIlike(["full_name"], "50%")).toBe('full_name.ilike."*50\\\\%*"');
  });
});

describe("matchesAnyField — parity reference for the OLD client-side filter", () => {
  // This is the exact semantics the platform page's handleFamilySearch used to
  // apply in JS. Kept as a pure function so the pushdown can be proven to agree
  // with it on ordinary terms, and to refuse cleanly on hostile ones.
  const rows = [
    { full_name: "Tan Wei Ming", email: "tan@example.com" },
    { full_name: "Marcus Lee", email: "marcus@swim.sg" },
    { full_name: "O'Brien, Aoife", email: "aoife@example.com" },
  ];
  const fields: SearchFieldMatcher<(typeof rows)[number]>[] = [
    (r) => r.full_name,
    (r) => r.email,
  ];

  it("matches a substring of the name, case-insensitively", () => {
    expect(rows.filter((r) => matchesAnyField(r, "tan", fields))).toHaveLength(1);
    expect(rows.filter((r) => matchesAnyField(r, "TAN", fields))).toHaveLength(1);
  });

  it("matches a substring of the email", () => {
    expect(
      rows.filter((r) => matchesAnyField(r, "swim.sg", fields)),
    ).toHaveLength(1);
  });

  it("treats a hostile term as a literal substring, never a wildcard", () => {
    // A comma is data, not grammar: it should match O'Brien's name literally.
    expect(
      rows.filter((r) => matchesAnyField(r, "brien, aoife", fields)),
    ).toHaveLength(1);
    // A lone wildcard char matches nobody (it is literal), never everybody.
    expect(rows.filter((r) => matchesAnyField(r, "%", fields))).toHaveLength(0);
    expect(rows.filter((r) => matchesAnyField(r, "*", fields))).toHaveLength(0);
  });

  it("a blank term matches everyone (the caller decides whether to search)", () => {
    expect(rows.filter((r) => matchesAnyField(r, "", fields))).toHaveLength(3);
    expect(rows.filter((r) => matchesAnyField(r, "   ", fields))).toHaveLength(3);
  });
});
