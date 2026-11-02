---
name: datefmt-lab
description: Writing strftime patterns and Intl.DateTimeFormat locale/options that format instants as expected.
---

# Date format lab

Parts: `instant` (a tdata Instant `["inst","<epoch ns>"]` or an ISO string), `strftime`
(`{format}`) and `intl` (`{locale, options}`). An expectation is meta
`https://tutuca.dev/d/expect` on a format, with one header per instant id: the exact output.

strftime directives (call `directives` for the full list): `%Y %m %d %H %M %S %y %b %B %a %A
%j %p %I %e %F %T %s %u %w %U %W %V %G %z %Z %L %%`. `%-d` drops the padding. An unknown
directive shows as `[%x?]` and makes the cell an error.

Workflow:
1. `formatted` to see each instant × format output and which expectations fail.
2. Fix a strftime with `set_strftime(id, format)`, an Intl format with `set_locale(id, locale)`
   and `set_intl_option(id, option, value)` (value "" removes the option).
3. Pin outputs the user confirms with `set_expectation(format, instant, expected)`.
