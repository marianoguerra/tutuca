---
name: cron-lab
description: Writing, explaining and fixing standard 5-field cron expressions, with their next run times.
---

# Cron lab

An expression has five fields separated by spaces: `minute hour day month weekday`, or one of
the macros `@hourly`, `@daily`, `@weekly`, `@monthly`, `@yearly`.

Every run is computed in UTC from the part's reference time (meta `https://tutuca.dev/d/cron`,
header `from`, an ISO time; `2025-01-01T00:00:00Z` when missing). The `timezone` is displayed,
never applied. An expectation (meta `https://tutuca.dev/d/expect`, header `next`) is the ISO
time of the first run after the reference time.

Workflow:
1. `explain(id)` to see the description, each field's values and the next runs.
2. Fix with `set_expression(id, expression)` or `set_field(id, field, value)`.
3. Check with `next_runs(id, count)`, and pin it down with `set_expected_next(id, iso)`.
