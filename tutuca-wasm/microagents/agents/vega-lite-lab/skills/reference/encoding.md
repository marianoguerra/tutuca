# Vega-Lite encodings

| channel | use |
|---|---|
| `x`, `y` | position |
| `x2`, `y2` | the end of a range (bars, rules, areas) |
| `color`, `fill`, `stroke` | a category or a scale of values |
| `size`, `opacity` | a quantitative value |
| `shape` | a category, for points |
| `text`, `tooltip` | the text a mark shows |
| `row`, `column`, `facet` | small multiples |

Field types: `quantitative` (numbers), `temporal` (dates), `ordinal` (ordered categories),
`nominal` (categories).

Aggregates: `count`, `sum`, `mean`, `median`, `min`, `max`, `distinct`, …; with `count` the
field may be left out.

Time units for temporal fields: `year`, `month`, `yearmonth`, `date`, `day`, `hours`, ….

Useful transforms: `filter` (`{"filter": "datum.revenue > 100"}`), `calculate`
(`{"calculate": "datum.a / datum.b", "as": "ratio"}`), `aggregate`, `fold`, `window`.
