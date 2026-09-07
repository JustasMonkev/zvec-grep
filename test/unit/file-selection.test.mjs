import assert from "node:assert/strict";
import test from "node:test";
import { compileFileSelection } from "../../dist/engine/utils/file-selection.js";
import {
  compilePathPattern,
  compileRipgrepGlob,
} from "../../dist/engine/utils/glob.js";

test("compiled patterns preserve path prefixes, glob syntax, and case across repeated calls", () => {
  const cases = [
    [
      compilePathPattern(" ./src// "),
      ["src", "src/a.ts", "src2/a.ts"],
      [false, true, false],
    ],
    [
      compilePathPattern("src"),
      ["src", "src/a.ts", "src2/a.ts"],
      [true, true, false],
    ],
    [
      compileRipgrepGlob("src"),
      ["src", "src/a.ts", "nested/src"],
      [true, false, true],
    ],
    [
      compileRipgrepGlob("src/{api,{core,ui}}/**"),
      ["src/api", "src/core/a.ts", "src/ui/a.ts", "src/other/a.ts"],
      [true, true, true, false],
    ],
    [
      compileRipgrepGlob("*.[ch]"),
      ["src/a.h", "src/a.c", "src/a.H"],
      [true, true, false],
    ],
    [
      compileRipgrepGlob("*.MD", true),
      ["docs/readme.md", "docs/README.MD", "docs/a.ts"],
      [true, true, false],
    ],
    [
      compilePathPattern("C:\\src", true),
      ["c:\\SRC\\a.ts", "C:/src2/a.ts"],
      [true, false],
    ],
    [
      compileRipgrepGlob("a?.[!c]"),
      ["dir/ab.h", "dir/ab.c", "dir/abc.h"],
      [true, false, false],
    ],
    [
      compileRipgrepGlob("[unfinished"),
      ["[unfinished", "unfinished"],
      [true, false],
    ],
    [compileRipgrepGlob(" "), ["", "src/a.ts"], [false, false]],
  ];
  for (const [matches, paths, expected] of cases) {
    for (let repeat = 0; repeat < 3; repeat++) {
      assert.deepEqual(paths.map(matches), expected);
    }
  }
  assert.throws(() => compileRipgrepGlob("[z-a]"), SyntaxError);
});

test("compiled file selection preserves last-match wins, negative-only rules, and type intersection", () => {
  const paths = ["src/a.ts", "src/a.test.ts", "docs/README.MD", "src/a.js"];
  const cases = [
    [{}, { include: [], exclude: [] }, [true, true, true, true]],
    [
      { globs: [" ", " ! "] },
      { include: [], exclude: [] },
      [true, true, true, true],
    ],
    [
      { globs: ["!*.test.ts"] },
      { include: [], exclude: [] },
      [true, false, true, true],
    ],
    [
      { globs: ["*.ts", "!*.test.ts", "a.test.ts"] },
      { include: [], exclude: [] },
      [true, true, false, false],
    ],
    [
      { globs: ["a.ts", "!*.ts"] },
      { include: [], exclude: [] },
      [false, false, false, false],
    ],
    [
      { globs: ["!*.ts"], insensitiveGlobs: ["A.TS", "*.md"] },
      { include: [], exclude: [] },
      [true, false, true, false],
    ],
    [
      { globs: ["src/**"] },
      { include: ["*.ts"], exclude: ["*.test.ts"] },
      [true, false, false, false],
    ],
  ];
  for (const [selection, types, expected] of cases) {
    const matches = compileFileSelection(selection, types);
    assert.deepEqual(paths.map(matches), expected);
    assert.deepEqual(
      [...paths].reverse().map(matches),
      [...expected].reverse(),
    );
  }
});

test("selections own their compiled rules without retaining mutable caller arrays", () => {
  const selection = { globs: ["*.ts"] };
  const types = { include: [], exclude: [] };
  const first = compileFileSelection(selection, types);
  selection.globs[0] = "*.md";
  types.exclude.push("README.md");
  const second = compileFileSelection(selection, types);
  assert.equal(first("src/a.ts"), true);
  assert.equal(second("src/a.ts"), false);
  assert.equal(second("docs/guide.md"), true);
  assert.equal(second("docs/README.md"), false);
});
