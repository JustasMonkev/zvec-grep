import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { cpus, tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const distPaths = (
  process.argv.length > 2 ? process.argv.slice(2) : ["dist"]
).map((path) => resolve(path));
const { createWorkspaceIndexStorage } = await import(
  pathToFileURL(join(distPaths[0], "engine/storage/index.js"))
);
const engines = await Promise.all(
  distPaths.map(async (dist) => ({
    dist,
    search: (
      await import(pathToFileURL(join(dist, "engine/pipeline/search/index.js")))
    ).searchWorkspaceIndex,
  })),
);
const fileCount = Number(process.env.ZG_BENCH_FILES ?? 20_000);
assert.ok(
  Number.isSafeInteger(fileCount) && fileCount >= 500,
  "ZG_BENCH_FILES must be an integer of at least 500",
);
const directory = await mkdtemp(join(tmpdir(), "zg-search-perf-"));
let storage;
try {
  storage = createWorkspaceIndexStorage({
    storagePath: join(directory, "index"),
    readOnly: false,
    embedding: {
      provider: "benchmark",
      dimension: 2,
      model: "benchmark",
      metric: "cosine",
    },
  });
  for (let index = 0; index < fileCount; index++) {
    const relativePath = `src/package-${index % 100}/handler-${index}.ts`;
    const id = createHash("sha256").update(relativePath).digest("hex");
    storage.replaceFile(
      {
        id,
        absolutePath: join(directory, relativePath),
        relativePath,
        rootPath: directory,
        sizeBytes: 100,
        lastModifiedTime: 100,
        kind: "code",
        format: "typescript",
      },
      [
        {
          fragment: {
            id: createHash("sha256").update(`${id}\x000`).digest("hex"),
            fileId: id,
            range: {
              kind: "text",
              startLine: 1,
              endLine: 1,
              startOffset: 0,
              endOffset: 30,
            },
            content: {
              kind: "text",
              text: `export function handler${index}() { return ${index}; }`,
            },
          },
          vector: [1, 0],
        },
      ],
    );
  }
  await storage.finalizeWrites();
  const context = { storage, workspaceIndex: { id: "benchmark" } };
  const cases = [
    { name: "unfiltered", plan: {} },
    { name: "broad-unfiltered", plan: {}, term: "return" },
    { name: "path-filtered", plan: { includePaths: ["src/package-42/**"] } },
    {
      name: "glob-filtered",
      plan: {
        globs: [
          "src/package-42/**",
          "!**/*.test.ts",
          "!**/*.spec.ts",
          "!**/generated/**",
          "!**/fixtures/**",
        ],
      },
    },
  ];
  const results = [];
  for (const { name, plan, term } of cases) {
    const measurements = engines.map((engine) => ({
      ...engine,
      times: [],
      filterTimes: [],
    }));
    for (let run = 0; run < 20; run++) {
      const target = 42 + (run % 5) * 100;
      const query = {
        ...plan,
        routes: [{ mode: "fts", query: term ?? `handler${target}` }],
        limit: 7,
      };
      let expected;
      const order = run % 2 === 0 ? measurements : [...measurements].reverse();
      for (const measurement of order) {
        const start = performance.now();
        const result = await measurement.search(query, context);
        const elapsed = performance.now() - start;
        if (term) {
          assert.equal(result.hits.length, 7);
        } else {
          assert.deepEqual(
            result.hits.map((hit) => hit.file.relativePath),
            [`src/package-42/handler-${target}.ts`],
          );
        }
        expected ??= result.hits;
        assert.deepEqual(
          result.hits,
          expected,
          `${name}: results must match between builds`,
        );
        if (run >= 5) {
          measurement.times.push(elapsed);
          measurement.filterTimes.push(
            result.timings.find((entry) => entry.name === "search_filter")
              .durationMs,
          );
        }
      }
    }
    results.push({
      name,
      builds: measurements.map(({ dist, times, filterTimes }) => {
        times.sort((a, b) => a - b);
        filterTimes.sort((a, b) => a - b);
        return {
          dist,
          medianMs: times[7],
          p95Ms: times[14],
          filterMedianMs: filterTimes[7],
          samplesMs: times,
        };
      }),
    });
  }
  console.log(
    JSON.stringify(
      {
        node: process.version,
        cpu: cpus()[0].model,
        fileCount,
        samples: 15,
        platform: `${process.platform}-${process.arch}`,
        equalResults: true,
        results,
      },
      null,
      2,
    ),
  );
} finally {
  try {
    storage?.close();
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}
