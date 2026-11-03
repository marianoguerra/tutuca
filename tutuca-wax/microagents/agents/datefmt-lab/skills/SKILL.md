---
name: datefmt-lab
description: Writing strftime patterns and Intl.DateTimeFormat locale/options that format instants as expected.
---

# Date format lab

The data is JSON: `instants` (`[{ id, iso }]`, ISO times, UTC when they have no offset),
`strftimes` (`[{ id, format, expect }]`) and `intls` (`[{ id, locale, options, expect }]`, the
options as strings, `hour12` "true" or "false"). A format's `expect` maps an instant id to the
exact output it should give. Format ids (f1, f2, …) are shared by both kinds; strftime formats
come first in the table's columns.

strftime directives (call `directives` for the full list): `%Y %m %d %H %M %S %y %b %B %a %A
%j %p %I %e %F %T %s %u %w %U %W %V %G %z %Z %L %%`. `%-d` drops the padding. An unknown
directive shows as `[%x?]` and makes the cell an error.

Workflow:
1. `formatted` to see each instant × format output and which expectations fail.
2. Fix a strftime with `set_strftime(id, format)`, an Intl format with `set_locale(id, locale)`
   and `set_intl_option(id, option, value)` (value "" removes the option).
3. Pin outputs the user confirms with `set_expectation(format, instant, expected)`.
