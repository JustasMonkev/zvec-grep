# Indexed search performance

The search engine used to copy every file record for every query, even without
file filters. Filtered queries also normalized patterns, allocated glob rules,
and constructed regular expressions inside the per-file loop.

The optimized implementation enumerates files only when a file filter needs
them. It compiles path, glob, and file-type matchers once per search or directory
scan, and skips normalization for paths already using single forward slashes.
Matchers live for one operation; there is no result cache or global pattern cache.

## Measured results

Baseline: `52653951b24617762f4ab0c71c34d594e5001617`.
Runtime: Node.js 24.19.0, Linux x64, AMD EPYC 9V74.
Times are medians from 15 measured samples per build, after five warmups.

| Indexed files | Query | Before | After | Speedup |
| ---: | --- | ---: | ---: | ---: |
| 20,000 | Targeted FTS, no file filters | 4.926 ms | 0.452 ms | 10.90× |
| 20,000 | Targeted FTS, path filter | 114.684 ms | 8.157 ms | 14.06× |
| 20,000 | Targeted FTS, five glob rules | 374.073 ms | 21.744 ms | 17.20× |
| 20,000 | Broad FTS, no file filters | 6.594 ms | 2.696 ms | 2.45× |
| 1,000 | Targeted FTS, no file filters | 0.533 ms | 0.371 ms | 1.44× |
| 1,000 | Targeted FTS, path filter | 6.230 ms | 0.686 ms | 9.08× |
| 1,000 | Targeted FTS, five glob rules | 21.156 ms | 1.876 ms | 11.28× |
| 1,000 | Broad FTS, no file filters | 2.313 ms | 2.151 ms | 1.08× |

The [raw samples](search-performance-results.json) include p95 latency and the
engine's rounded file-filter timing. Results depend on workspace size and query
selectivity; these measurements do not establish a uniform 10× application speedup.

## What the benchmark measures

`search-performance.mjs` populates real native zvec storage with a synthetic
workspace: 100 packages, one TypeScript function and one indexed fragment per
file. Targeted searches rotate among five function names, returning one hit.
The path filter selects one package; the glob case adds four exclusions for
test, spec, generated, and fixture paths. Broad queries match every fragment
and return seven hits through normal recall and ranking.

Both builds use the same populated, optimized storage instance. Storage code is
unchanged by this optimization. The benchmark alternates build order each round
and deep-compares every returned hit, including scores, ranks, evidence, ranges,
and file metadata. Expected hit paths or counts are checked independently.
The corpus setup and assertions are outside timed intervals.

Each interval measures the complete `searchWorkspaceIndex` call, including plan
validation, file selection, native FTS recall, fusion, and result materialization.
It excludes CLI startup, daemon HTTP transport, filesystem freshness checks,
index creation, embedding inference, and model downloads. It does not measure
semantic-search quality or end-to-end agent task duration. Run without other
CPU-intensive jobs for comparable measurements.

## Reproduce

From the optimized checkout, build a clean baseline worktree and this checkout:

```sh
git worktree add --detach ../zvec-grep-before 52653951b24617762f4ab0c71c34d594e5001617
cd ../zvec-grep-before
npm ci
npm run build
cd -
npm ci
npm run build
node benchmarks/search-performance.mjs ../zvec-grep-before/dist dist
ZG_BENCH_FILES=1000 node benchmarks/search-performance.mjs ../zvec-grep-before/dist dist
```

The benchmark uses a temporary database and deletes it on completion. With no
arguments it measures the current `dist` build alone. `ZG_BENCH_FILES` must be an
integer of at least 500.

## Correctness and cleanup

Regression tests cover filter precedence, case-insensitive overrides, recursive
globs, directory prefixes, Windows paths, character classes, literal malformed
delimiters, empty and negative-only rules, type intersections, changed file
metadata, and explicit zero timestamp filters. Unfiltered and symbol-only
searches fail their regression test if they enumerate all files again.

A manual mutation changed the glob loop boundary from `index >= 0` to
`index > 0`. The regression tests failed, and passed after restoring the code.
An additional 6,358 before/after comparisons of the existing path and glob
helpers matched across mixed separators, Unicode, case, and rule combinations.
No dependency, storage schema, ranking formula, or embedding model changed.

`npm run check` passed: lint, formatting, typecheck, coverage, and package
installation/CLI/API validation. Across its test runs, 385 tests passed and one
pre-existing Windows-path test was skipped. Coverage was 89.02% lines, 83.74%
branches, and 94.79% functions. The lazy-clean scan of all seven changed JS/TS
files reported no findings; the rest of the repository retains pre-existing
checker warnings outside these performance changes.
