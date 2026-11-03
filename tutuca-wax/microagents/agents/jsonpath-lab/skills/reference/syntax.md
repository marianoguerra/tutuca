# JSONPath syntax (jsonpath-plus)

| expression | selects |
|---|---|
| `$` | the root |
| `$.a.b` / `$['a']['b']` | a child by name; use brackets for names with spaces or dots |
| `$.a[0]` / `$.a[-1:]` | an item by index / the last item |
| `$.a[*]` / `$.a.*` | every item or member |
| `$..x` | every `x` at any depth (deep scan) |
| `$.a[0,2]` / `$.a[1:3]` | a union of indexes / a slice (end excluded) |
| `$.a[?(@.price < 10)]` | items whose filter is true; `@` is the item |
| `$.a[?(@.tags && @.tags.includes('x'))]` | filters can call methods on the item's values |
| `$.a[(@.length-1)]` | a script: the index it computes |
| `$..*` | every node below the root |
| `$.a~` | the property names instead of the values (jsonpath-plus) |
| `$..[?(@property === 'id')]` | `@property` is the current key, `@parent` the parent |

Filter operators: `==`, `===`, `!=`, `<`, `<=`, `>`, `>=`, `&&`, `||`, `!`.
