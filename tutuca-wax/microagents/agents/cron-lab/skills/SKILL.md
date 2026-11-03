---
name: cron-lab
description: Writing, explaining and fixing standard 5-field cron expressions, with their next run times.
---

# Cron lab

An expression has five fields separated by spaces: `minute hour day month weekday`, or one of
the macros `@hourly`, `@daily`, `@weekly`, `@monthly`, `@yearly`.

The data is `{ crons: [{ id, expression, timezone, from, expect_next }] }`. Every run is computed
in UTC from the cron's reference time `from` (an ISO time; `2025-01-01T00:00:00Z` when it is "").
The `timezone` is never applied to the runs: each run is also shown as it reads in that zone.
`expect_next` is the ISO time of the first run after the reference time ("" for no expectation).

Workflow:
1. `explain(id)` to see the description, each field's values and the next runs.
2. Fix with `set_expression(id, expression)` or `set_field(id, name, value)`.
3. Check with `next_runs(id, count)`, move the reference time with `set_from(id, iso)`, and pin
   the first run down with `set_expected_next(id, iso)`.
