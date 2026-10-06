// Engine of scripts/check-runtime-identical.sh — read that file's header first.
//
//   node runtime-identical.mjs <root> <base> <head> <path>...
//
// Each <path> is a .ts/.tsx file under SwimSyncApp/ or SwimSyncAdmin/ that exists at
// both <base> and <head>. Both versions are transpiled with the app's OWN TypeScript
// (`transpileModule`: removeComments, jsx Preserve, target/module ESNext — the same
// erasure Babel/SWC perform), re-parsed, and compared as SYNTAX TREES: whitespace and
// formatting are invisible, every string/template/JSX text is compared exactly.
//
// Two normalisations, both semantics-preserving and both stated so nobody widens them:
//   1. A ParenthesizedExpression is compared as its inner expression. Precedence lives
//      in the tree shape, so `(a + b) * c` and `a + b * c` still differ; `(a?.b).c` and
//      `a?.b.c` still differ (the optional-chain flag is compared).
//   2. `fromJson(x, "<sql_fn>")`, where `fromJson` is imported from a module ending in
//      `database.overrides`, is compared as `x`, and that import specifier is ignored —
//      ONLY after this run has proven `fromJson` is the identity (`return value;`) in
//      the head version of that app's lib/database.overrides.ts. It is the plan's single
//      permitted narrowing of a `Json` RPC result (Wave 8 RISK 8); without this, every
//      such site would read as a runtime change.
//
// Exit: 0 identical · 1 a difference (a unified diff of the transpiled JS is printed) ·
//       2 broken.

import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const [root, base, head, ...paths] = process.argv.slice(2);
if (!root || !base || !head) {
  console.error("usage: runtime-identical.mjs <root> <base> <head> <path>...");
  process.exit(2);
}

const tsByApp = new Map();
function tsFor(app) {
  if (!tsByApp.has(app)) {
    const req = createRequire(join(root, app, "package.json"));
    try {
      tsByApp.set(app, req("typescript"));
    } catch {
      console.error(`✗ ${app}/node_modules/typescript is missing — run npm ci in ${app}`);
      process.exit(2);
    }
  }
  return tsByApp.get(app);
}

function show(rev, path) {
  try {
    return execFileSync("git", ["-C", root, "show", `${rev}:${path}`], {
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024,
      stdio: ["ignore", "pipe", "ignore"],
    });
  } catch {
    return null;
  }
}

function transpile(ts, text, path) {
  return ts.transpileModule(text, {
    fileName: path,
    compilerOptions: {
      removeComments: true,
      jsx: ts.JsxEmit.Preserve,
      target: ts.ScriptTarget.ESNext,
      module: ts.ModuleKind.ESNext,
      isolatedModules: true,
    },
    reportDiagnostics: false,
  }).outputText;
}

// Is `fromJson` in this app's overrides (at head) exactly `function fromJson(v, …) { return v; }`?
const identityByApp = new Map();
function fromJsonIsIdentity(app) {
  if (identityByApp.has(app)) return identityByApp.get(app);
  const ts = tsFor(app);
  const p = `${app}/lib/database.overrides.ts`;
  const text = show(head, p);
  let ok = false;
  if (text != null) {
    const sf = ts.createSourceFile("o.js", transpile(ts, text, p), ts.ScriptTarget.ESNext, true, ts.ScriptKind.JS);
    for (const st of sf.statements) {
      if (!ts.isFunctionDeclaration(st) || st.name?.text !== "fromJson") continue;
      const param = st.parameters[0]?.name;
      const body = st.body?.statements ?? [];
      ok =
        !st.asteriskToken &&
        !st.modifiers?.some((m) => m.kind === ts.SyntaxKind.AsyncKeyword) &&
        param != null && ts.isIdentifier(param) &&
        body.length === 1 && ts.isReturnStatement(body[0]) &&
        body[0].expression != null && ts.isIdentifier(body[0].expression) &&
        body[0].expression.text === param.text;
    }
  }
  identityByApp.set(app, ok);
  return ok;
}

function serialise(ts, js, path, app) {
  const sf = ts.createSourceFile(
    path.replace(/\.tsx?$/, path.endsWith("x") ? ".jsx" : ".js"),
    js, ts.ScriptTarget.ESNext, true, path.endsWith("x") ? ts.ScriptKind.JSX : ts.ScriptKind.JS);

  // Local names bound to fromJson by an import from …database.overrides.
  const fromJsonNames = new Set();
  const isOverrides = (s) => ts.isStringLiteral(s) && /(^|\/)database\.overrides$/.test(s.text);
  for (const st of sf.statements) {
    if (!ts.isImportDeclaration(st) || !isOverrides(st.moduleSpecifier)) continue;
    const nb = st.importClause?.namedBindings;
    if (nb && ts.isNamedImports(nb)) {
      for (const el of nb.elements) {
        if ((el.propertyName ?? el.name).text === "fromJson") fromJsonNames.add(el.name.text);
      }
    }
  }
  const normaliseFromJson = fromJsonNames.size > 0 && fromJsonIsIdentity(app);

  const FLAGS = ts.NodeFlags.Let | ts.NodeFlags.Const | ts.NodeFlags.OptionalChain |
    ts.NodeFlags.Using | ts.NodeFlags.AwaitUsing;
  const out = [];
  const walk = (node) => {
    if (ts.isParenthesizedExpression(node)) return walk(node.expression);
    if (normaliseFromJson && ts.isCallExpression(node) && ts.isIdentifier(node.expression) &&
        fromJsonNames.has(node.expression.text) && node.arguments.length === 2 &&
        ts.isStringLiteralLike(node.arguments[1])) {
      return walk(node.arguments[0]);
    }
    if (normaliseFromJson && ts.isImportDeclaration(node) && isOverrides(node.moduleSpecifier)) {
      const nb = node.importClause?.namedBindings;
      const rest = nb && ts.isNamedImports(nb)
        ? nb.elements.filter((el) => !fromJsonNames.has(el.name.text)) : null;
      if (rest && rest.length === 0 && !node.importClause.name) return; // only fromJson: ignore
      out.push("(ImportDeclaration", node.moduleSpecifier.text,
        ...(node.importClause?.name ? ["default", node.importClause.name.text] : []),
        ...(rest ?? []).map((el) => `${el.propertyName?.text ?? ""}:${el.name.text}`), ")");
      return;
    }
    out.push("(" + ts.SyntaxKind[node.kind]);
    const f = node.flags & FLAGS;
    if (f) out.push(`#${f}`);
    for (const k of ["operator", "token", "keywordToken"]) {
      if (typeof node[k] === "number") out.push(`${k}=${node[k]}`);
    }
    if (ts.isIdentifier(node) || ts.isPrivateIdentifier(node) || ts.isLiteralExpression(node) ||
        ts.isTemplateLiteralLike?.(node) || ts.isTemplateMiddleOrTemplateTail?.(node) ||
        ts.isTemplateHead?.(node) || ts.isJsxText(node)) {
      out.push(JSON.stringify(node.text));
    }
    ts.forEachChild(node, walk);
    out.push(")");
  };
  sf.statements.forEach(walk);
  return out.join(" ");
}

let differ = 0;
const work = mkdtempSync(join(tmpdir(), "runtime-identical-"));
try {
  for (const path of paths) {
    const app = path.split("/")[0];
    const ts = tsFor(app);
    const a = show(base, path), b = show(head, path);
    if (a == null || b == null) {
      console.error(`✗ ${path}: missing at ${a == null ? base : head}`);
      process.exit(2);
    }
    const ja = transpile(ts, a, path), jb = transpile(ts, b, path);
    if (serialise(ts, ja, path, app) === serialise(ts, jb, path, app)) continue;
    differ++;
    const fa = join(work, "base.js"), fb = join(work, "head.js");
    writeFileSync(fa, ja);
    writeFileSync(fb, jb);
    let d = "";
    try {
      execFileSync("diff", ["-u", "--label", `${path} @ ${base}`, "--label", `${path} @ ${head}`, fa, fb], { encoding: "utf8" });
    } catch (e) {
      d = e.stdout ?? "";
    }
    console.log(`✗ RUNTIME CHANGE: ${path}\n${d || "  (the trees differ; the emitted text differs only in formatting — compare by eye)\n"}`);
  }
} finally {
  rmSync(work, { recursive: true, force: true });
}
if (differ) process.exit(1);
console.log(`✓ ${paths.length} changed .ts/.tsx file(s) transpile to the same program`);
