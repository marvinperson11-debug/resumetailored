#!/usr/bin/env node
/**
 * Hard-coded user-facing string audit + ratchet.
 *
 *   node scripts/i18n-audit.mjs            # report (per-file counts)
 *   node scripts/i18n-audit.mjs --list     # also print every finding
 *   node scripts/i18n-audit.mjs --check    # CI: fail if any file has MORE findings than
 *                                          # scripts/i18n-baseline.json (new file => baseline 0)
 *   node scripts/i18n-audit.mjs --update   # rewrite the baseline (only ever after FIXING strings)
 *
 * It walks app/, components/ (UI code — not app/api, not tests) with the TypeScript
 * parser and flags JSX text, string/template literals and JSX string props that look
 * like English prose (two or more words of letters) and are not obviously code:
 * import paths, class names, URLs, object keys, comparison operands, translator
 * calls t("key"), etc. It is a heuristic ratchet, not a proof: it cannot see a single
 * English word ("Save") in a variable, so `react/jsx-no-literals` (eslintrc.i18n.json)
 * covers bare JSX words and this script covers prose in strings.
 */
import fs from "node:fs";
import path from "node:path";
import ts from "typescript";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const BASELINE = path.join(ROOT, "scripts/i18n-baseline.json");
const SCAN = ["app", "components"];
const SKIP_DIR = /(^|\/)(api|node_modules|\.next)(\/|$)/;
/** Files whose English is deliberate (documented in I18N_*_REPORT.md): sample/demo content, editor chrome for user documents. */
const SKIP_FILE = /(templates-gallery|template-preview|opengraph-image|apple-icon|icon)\.tsx?$/;
const IGNORED_PROPS = new Set([
  "className", "class", "href", "src", "key", "id", "type", "name", "htmlFor", "style", "target", "rel", "role", "method",
  "accept", "autoComplete", "inputMode", "data-testid", "viewBox", "d", "fill", "stroke", "width", "height", "value", "as", "variant", "tone",
]);
const PROSE = /[A-Za-z]{2,}[\s][A-Za-z]{2,}/; // two+ words
const CODEISH = /(^|\s)(https?:|\/[a-z]|#[0-9a-f]{3,8}\b|[a-z]+-[a-z0-9]+-|\.\w{2,4}$)|[{};=<>]|\b(px|rem|em|vh|vw)\b|^[\w.-]+\/[\w./-]+$/i;

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    const rel = path.relative(ROOT, p);
    if (SKIP_DIR.test(rel)) continue;
    if (e.isDirectory()) walk(p, out);
    else if (/\.tsx?$/.test(e.name) && !/\.d\.ts$/.test(e.name) && !SKIP_FILE.test(e.name)) out.push(p);
  }
  return out;
}

/** Product / placeholder names that are intentionally not translated. */
const ALLOWED = new Set(["Employer Portal", "ResumeTailored", "ResumeTailored Pro", "Jordan Lee", "Resume Video", "Web Studio", "Career Hub"]);
const WORD = /^[A-Za-z][A-Za-z'’,.!?…]*$/;
/** Bare Tailwind utilities that look like words ("block truncate text-sm"). */
const UTILITY = new Set(["block", "inline", "flex", "grid", "hidden", "truncate", "relative", "absolute", "fixed", "sticky", "border", "rounded", "shadow", "uppercase", "lowercase", "capitalize", "italic", "underline", "transition", "container", "static", "visible", "invisible", "contents", "table", "grow", "shrink", "resize", "outline", "ring", "blur", "filter", "antialiased", "isolate", "sr-only"]);

/** Single UI words that are almost never anything but a label/button/heading. */
const UI_WORDS = new Set(["save", "cancel", "delete", "remove", "close", "loading", "refresh", "search", "back", "submit", "edit", "add", "done", "next", "previous", "continue", "confirm", "retry", "upload", "download", "sign out", "sign in", "log out", "log in", "settings", "profile", "home", "help", "send", "view", "open", "copy", "copied", "share", "apply", "yes", "no", "ok", "error", "success", "warning", "name", "email", "password", "phone", "status", "actions", "date", "title", "description", "optional", "required", "all", "none", "more", "less", "preview", "publish", "unpublish", "install app"]);

function isProse(text) {
  const s = text.replace(/\s+/g, " ").trim();
  // Labels are capitalised ("Save"); lowercase/UPPERCASE singles are state values and HTTP methods.
  if (/^[A-Z][a-z]/.test(s) && UI_WORDS.has(s.toLowerCase().replace(/[…:.!]+$/, ""))) return true;
  if (s.length < 5 || ALLOWED.has(s) || !PROSE.test(s) || CODEISH.test(s)) return false;
  // Tailwind/utility class lists are mostly hyphenated/colon tokens; prose has >= 2 plain words.
  return s.split(" ").filter((w) => WORD.test(w) && !UTILITY.has(w.toLowerCase())).length >= 2;
}

function audit(file) {
  const src = fs.readFileSync(file, "utf8");
  const sf = ts.createSourceFile(file, src, ts.ScriptTarget.Latest, true, file.endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const found = [];
  const add = (node, text) => {
    const { line } = sf.getLineAndCharacterOfPosition(node.getStart());
    found.push({ line: line + 1, text: text.replace(/\s+/g, " ").trim().slice(0, 90) });
  };
  const visit = (node) => {
    const parent = node.parent;
    if (ts.isJsxText(node)) {
      if (isProse(node.getText())) add(node, node.getText());
    } else if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
      let skip = false;
      if (ts.isExpressionStatement(parent)) skip = true; // "use client" directives
      else if (ts.isImportDeclaration(parent) || ts.isExportDeclaration(parent) || ts.isExternalModuleReference(parent)) skip = true;
      else if (ts.isPropertyAssignment(parent) && parent.name === node) skip = true; // object key
      else if (ts.isBinaryExpression(parent) && /^(===|!==|==|!=)$/.test(parent.operatorToken.getText())) skip = true;
      else if (ts.isCaseClause(parent)) skip = true;
      else if (ts.isJsxAttribute(parent.parent ?? parent) && IGNORED_PROPS.has((parent.parent ?? parent).name?.getText?.())) skip = true;
      else if (ts.isJsxAttribute(parent) && IGNORED_PROPS.has(parent.name.getText())) skip = true;
      else if (ts.isCallExpression(parent)) {
        const callee = parent.expression.getText();
        // translator lookups, fetches, DOM/CSS/console plumbing
        if (/^(t|tc|tE|tUi|tp|tj|tc\w*|t\.\w+|fetch|require|console\.\w+|redirect|permanentRedirect|router\.\w+|window\.\w+|document\.\w+|localStorage\.\w+|sessionStorage\.\w+|cn|clsx|new URL|URLSearchParams\w*|\w+\.(get|set|has|append|delete|includes|startsWith|endsWith|test|match|replace|split|indexOf|querySelector\w*|addEventListener|removeEventListener|getElementById|getItem|setItem|removeItem))$/.test(callee)) skip = true;
      } else if (ts.isElementAccessExpression(parent)) skip = true;
      else if (ts.isNewExpression(parent) && /^(URL|Error|RegExp)$/.test(parent.expression.getText()) && false) skip = true;
      if (!skip && isProse(node.text)) add(node, node.text);
    } else if (ts.isTemplateHead(node)) {
      const tpl = parent.parent; // TemplateExpression
      const inCall = ts.isCallExpression(tpl.parent) && /^(fetch|t\w*|cn|clsx|redirect|router\.\w+)$/.test(tpl.parent.expression.getText());
      const inClass = ts.isJsxExpression(tpl.parent) && ts.isJsxAttribute(tpl.parent.parent) && IGNORED_PROPS.has(tpl.parent.parent.name.getText());
      if (!inCall && !inClass && isProse(node.text)) add(node, node.text);
    } else if (ts.isTemplateMiddle(node) || ts.isTemplateTail(node)) {
      const tpl = parent.parent;
      const top = ts.isTemplateSpan(parent) ? parent.parent : tpl;
      const p2 = top?.parent;
      const inCall = p2 && ts.isCallExpression(p2) && /^(fetch|t\w*|cn|clsx|redirect|router\.\w+)$/.test(p2.expression.getText());
      const inClass = p2 && ts.isJsxExpression(p2) && ts.isJsxAttribute(p2.parent) && IGNORED_PROPS.has(p2.parent.name.getText());
      if (!inCall && !inClass && isProse(node.text)) add(node, node.text);
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return found;
}

const args = new Set(process.argv.slice(2));
const result = {};
const details = {};
for (const d of SCAN) {
  const dir = path.join(ROOT, d);
  if (!fs.existsSync(dir)) continue;
  for (const f of walk(dir)) {
    const found = audit(f);
    const rel = path.relative(ROOT, f);
    if (found.length) {
      result[rel] = found.length;
      details[rel] = found;
    }
  }
}
const total = Object.values(result).reduce((a, b) => a + b, 0);
const sorted = Object.entries(result).sort((a, b) => b[1] - a[1]);

if (args.has("--update")) {
  fs.writeFileSync(BASELINE, JSON.stringify(Object.fromEntries(sorted.sort((a, b) => a[0].localeCompare(b[0]))), null, 2) + "\n");
  console.log(`baseline written: ${total} findings in ${sorted.length} files`);
  process.exit(0);
}

if (args.has("--check")) {
  const base = fs.existsSync(BASELINE) ? JSON.parse(fs.readFileSync(BASELINE, "utf8")) : {};
  const regress = sorted.filter(([f, n]) => n > (base[f] ?? 0));
  if (regress.length) {
    console.error("New hard-coded user-facing strings (translate them via next-intl; see messages/*.json):\n");
    for (const [f, n] of regress) {
      console.error(`  ${f}: ${n} (baseline ${base[f] ?? 0})`);
      const known = base[f] ?? 0;
      for (const item of details[f].slice(known)) console.error(`      line ${item.line}: ${item.text}`);
    }
    console.error("\nIf a string is genuinely not user-facing, rephrase it (e.g. put it in a constant named for what it is) or add the file to SKIP_FILE in scripts/i18n-audit.mjs with a reason.");
    process.exit(1);
  }
  const improved = sorted.length < Object.keys(base).length || Object.keys(base).some((f) => (result[f] ?? 0) < base[f]);
  console.log(`i18n audit OK: ${total} known findings in ${sorted.length} files, none new.` + (improved ? " (Some files improved — run with --update to lock the gain in.)" : ""));
  process.exit(0);
}

console.log(`Hard-coded user-facing strings: ${total} in ${sorted.length} files\n`);
for (const [f, n] of sorted) {
  console.log(`${String(n).padStart(4)}  ${f}`);
  if (args.has("--list")) for (const item of details[f]) console.log(`        ${item.line}: ${item.text}`);
}
