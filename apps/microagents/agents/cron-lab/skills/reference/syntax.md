# Cron syntax

| field | values | names |
|---|---|---|
| minute | 0-59 | |
| hour | 0-23 | |
| day (of the month) | 1-31 | |
| month | 1-12 | JAN-DEC |
| weekday | 0-7 (0 and 7 are Sunday) | SUN-SAT |

Each field is a comma-separated list of:

| form | meaning |
|---|---|
| `*` | every value |
| `5` | one value |
| `1-5` | a range, both ends included |
| `*/15` | every 15th value from the lowest |
| `10-40/10` | every 10th value within the range |
| `5/20` | every 20th value from 5 to the highest |

Macros: `@yearly` (`0 0 1 1 *`), `@monthly` (`0 0 1 * *`), `@weekly` (`0 0 * * 0`), `@daily`
(`0 0 * * *`), `@hourly` (`0 * * * *`).

When both day and weekday are restricted (neither starts with `*`), the job runs on days that
match either one: `0 9 1 * MON` runs on the 1st and on every Monday.
