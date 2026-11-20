---
name: glob-lab
description: Writing, testing and fixing glob patterns (picomatch) against a list of paths with match/no-match expectations.
---

# Glob lab

Globs are matched with picomatch in posix mode: paths use `/`, and a glob must match the whole
path. Options per glob: `dot` (wildcards also match names starting with `.`) and `nocase`.

An expectation on a glob is `match` or `no-match` for a path. Paths in expectations needn't be
in the paths list, but usually are.

Workflow:
1. `matches(glob)` to see what a glob matches and which expectations fail.
2. `explain(glob)` to see the regex it compiles to, its base directory and whether it's a glob.
3. `setGlob` with the fix; its answer is the summary; call `matches` again for details.
4. Pin the cases the user cares about with `setExpectation(glob, path, outcome)`.

The paths are one string, one path per line: `setPaths` replaces all of them.
