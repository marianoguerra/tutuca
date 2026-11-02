---
name: regex-lab
description: Writing, testing and fixing JavaScript regular expressions against example texts with pass/fail expectations.
---

# Regex lab

Regexes are JavaScript `RegExp` sources: write the pattern without the surrounding slashes and
the flags separately (`set_regex("r1", "^\\d{4}-\\d{2}$", "u")`).

A text's expectation for a regex is `match` (the regex should find at least one match in it) or
`no-match`. Whether a regex matches is `new RegExp(pattern, flags).test(text)` with the `g` and
`y` flags left out.

Workflow:
1. `grid` to see which cells fail.
2. `explain_matches(regex, text)` on a failing cell to see what the regex finds.
3. `set_regex` with the fix, then `grid` again.
4. Add texts (`add_text`) and expectations (`set_expectation`) for the cases the user cares
   about, so the fix is pinned down.
