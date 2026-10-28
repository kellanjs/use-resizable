/**
 * The README is the library's contract, so its examples are checked: every
 * fenced `ts` or `tsx` block that imports from "@kellanjs/use-resizable"
 * is a complete example, and must type-check against the library's own
 * source with the repo's compiler options, resolving modules as an app's
 * bundler does (Next.js, Vite). (Blocks without that import are
 * fragments, and aren't checked.) A block whose first line is a comment
 * naming a file (`// shell.tsx`) is written under that name, so the blocks
 * of a multi-file example can import each other (`./shell`).
 *
 * Also checked: links to headings in the README resolve, inline code
 * spans aren't split across lines, and the exports it lists are the
 * package's.
 */
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { describe, expect, it } from "vitest";

const packageDir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const index = path.join(packageDir, "src", "index.ts");
const readme = readFileSync(path.join(packageDir, "README.md"), "utf8");
const lines = readme.split(/\r?\n/);

interface Block {
  /** The README line its code starts on (1-based). */
  readonly line: number;
  readonly lang: string;
  readonly code: string;
}

/** Every fenced block, with its code unindented (as in a list item). */
function fencedBlocks(): Block[] {
  const found: Block[] = [];
  for (let index = 0; index < lines.length; index++) {
    const open = /^(\s*)```(\w*)\s*$/.exec(lines[index]);
    if (!open) continue;
    const [, indent, lang] = open;
    let end = index + 1;
    while (end < lines.length && !/^\s*```\s*$/.test(lines[end])) end++;
    const code = lines
      .slice(index + 1, end)
      .map((line) =>
        line.startsWith(indent) ? line.slice(indent.length) : line.trimStart(),
      )
      .join("\n");
    found.push({ line: index + 2, lang, code });
    index = end;
  }
  return found;
}

/** The lines of the README outside fenced blocks. */
function proseLines(): { line: number; text: string }[] {
  const prose: { line: number; text: string }[] = [];
  let fenced = false;
  lines.forEach((text, index) => {
    if (/^\s*```/.test(text)) fenced = !fenced;
    else if (!fenced) prose.push({ line: index + 1, text });
  });
  return prose;
}

/** A heading's anchor, as GitHub makes it. */
function slug(heading: string): string {
  return heading
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s_-]/gu, "")
    .replace(/\s/g, "-");
}

describe("the README", () => {
  it("has examples that type-check", () => {
    const examples = fencedBlocks().filter(
      (block) =>
        (block.lang === "ts" || block.lang === "tsx") &&
        block.code.includes('from "@kellanjs/use-resizable"'),
    );
    expect(examples.length).toBeGreaterThan(0);

    const dir = mkdtempSync(path.join(tmpdir(), "use-resizable-readme-"));
    try {
      const files = new Map<string, Block>();
      for (const block of examples) {
        const named = /^\/\/ ([\w.-]+\.tsx?)\b/.exec(block.code)?.[1];
        const name = named ?? `line-${block.line}.${block.lang}`;
        const file = path.join(dir, name);
        if (files.has(file)) {
          throw new Error(
            `README line ${block.line}: another example is also named ${name}.`,
          );
        }
        files.set(file, block);
        writeFileSync(file, block.code);
      }

      const require = createRequire(import.meta.url);
      const nodeModules = path.dirname(
        path.dirname(require.resolve("react/package.json")),
      );
      const config = ts.readConfigFile(
        path.join(packageDir, "tsconfig.json"),
        (file) => ts.sys.readFile(file),
      );
      const { options } = ts.convertCompilerOptionsFromJson(
        config.config.compilerOptions,
        packageDir,
      );
      // Next's `cookies()`, for the server rendering example, declared
      // rather than installing Next.
      const stubs = [path.join(packageDir, "testing", "next-headers.d.ts")];
      const program = ts.createProgram([...files.keys(), ...stubs], {
        ...options,
        module: ts.ModuleKind.ESNext,
        moduleResolution: ts.ModuleResolutionKind.Bundler,
        rootDir: undefined,
        outDir: undefined,
        declaration: false,
        noEmit: true,
        incremental: false,
        plugins: [],
        typeRoots: [path.join(nodeModules, "@types")],
        types: ["node"],
        paths: {
          "@kellanjs/use-resizable": [index],
          // The examples are outside the repo: their other imports
          // (React) resolve from its packages, types first.
          "*": [
            path.join(nodeModules, "@types", "*"),
            path.join(nodeModules, "*"),
          ],
        },
      });

      const errors = ts.getPreEmitDiagnostics(program).map((diagnostic) => {
        const message = ts.flattenDiagnosticMessageText(
          diagnostic.messageText,
          "\n",
        );
        if (!diagnostic.file || diagnostic.start === undefined) return message;
        const { line } = diagnostic.file.getLineAndCharacterOfPosition(
          diagnostic.start,
        );
        const block = files.get(path.normalize(diagnostic.file.fileName));
        if (!block) {
          return `${diagnostic.file.fileName}:${line + 1}: ${message}`;
        }
        const source = block.code.split("\n")[line]?.trim();
        return `README line ${block.line + line} (example at line ${block.line}): ${message}\n    ${source}`;
      });
      expect(errors, errors.join("\n\n")).toEqual([]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
    // A whole program, the library included.
  }, 60_000);

  it("links only to headings it has", () => {
    const anchors = new Set<string>();
    const counts = new Map<string, number>();
    for (const { text } of proseLines()) {
      const heading = /^#{1,6} (.+)$/.exec(text);
      if (!heading) continue;
      const base = slug(heading[1]);
      const seen = counts.get(base) ?? 0;
      counts.set(base, seen + 1);
      anchors.add(seen === 0 ? base : `${base}-${seen}`);
    }
    const broken = proseLines().flatMap(({ line, text }) =>
      [...text.matchAll(/\]\(#([^)]+)\)/g)]
        .filter(([, anchor]) => !anchors.has(anchor))
        .map(([, anchor]) => `line ${line}: #${anchor}`),
    );
    expect(broken).toEqual([]);
  });

  it("keeps each inline code span on one line", () => {
    const split = proseLines()
      .filter(({ text }) => !/^\s*\|/.test(text))
      .filter(({ text }) => {
        // Double backticks open a span that may hold single ones.
        const ticks = text.replace(/``[^`]*``/g, "").match(/`/g) ?? [];
        return ticks.length % 2 === 1;
      })
      .map(({ line, text }) => `line ${line}: ${text}`);
    expect(split).toEqual([]);
  });

  it("lists the package's exports", () => {
    const source = readFileSync(index, "utf8");
    const file = ts.createSourceFile(
      "index.ts",
      source,
      ts.ScriptTarget.Latest,
    );
    const exported = new Set<string>();
    for (const statement of file.statements) {
      if (
        ts.isExportDeclaration(statement) &&
        statement.exportClause &&
        ts.isNamedExports(statement.exportClause)
      ) {
        for (const element of statement.exportClause.elements) {
          exported.add(element.name.text);
        }
      }
    }
    const start = lines.findIndex((line) => line === "### Exports");
    expect(start).toBeGreaterThan(-1);
    const end = lines.findIndex(
      (line, index) => index > start && /^#{1,3} /.test(line),
    );
    const listed = new Set(
      [
        ...lines
          .slice(start, end)
          .join("\n")
          .matchAll(/`(\w+)`/g),
      ].map(([, name]) => name),
    );
    expect([...listed].filter((name) => !exported.has(name))).toEqual([]);
    expect([...exported].filter((name) => !listed.has(name))).toEqual([]);
  });
});
