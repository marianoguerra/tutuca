# JSON Schema 2020-12 keywords, briefly

| keyword | applies to | meaning |
|---|---|---|
| `type` | any | `"string"`, `"number"`, `"integer"`, `"boolean"`, `"object"`, `"array"`, `"null"`, or an array of them |
| `enum` / `const` | any | the value is one of the list / equals the value |
| `properties` | object | a schema per property name |
| `required` | object | property names that must be present |
| `additionalProperties` | object | schema (or `false`) for properties not in `properties` or `patternProperties` |
| `patternProperties` | object | a schema per key regex |
| `unevaluatedProperties` | object | like additionalProperties, but sees through `allOf`/`$ref` |
| `minProperties` / `maxProperties` | object | key count bounds |
| `items` | array | a schema every item (after `prefixItems`) must match |
| `prefixItems` | array | schemas for the first items, by position |
| `minItems` / `maxItems` / `uniqueItems` | array | length bounds, no duplicates |
| `contains` / `minContains` / `maxContains` | array | how many items match a schema |
| `minLength` / `maxLength` / `pattern` | string | length bounds, a regex (not anchored) |
| `format` | string | `email`, `date`, `date-time`, `time`, `uri`, `uuid`, `ipv4`, `ipv6`, `hostname`, … |
| `minimum` / `maximum` / `exclusiveMinimum` / `exclusiveMaximum` / `multipleOf` | number | numeric bounds |
| `allOf` / `anyOf` / `oneOf` / `not` | any | combine schemas |
| `if` / `then` / `else` | any | conditional schemas |
| `$defs` / `$ref` | any | reusable schemas: `{"$ref": "#/$defs/address"}` |
| `dependentRequired` | object | `{"card": ["cvv"]}`: if `card` is present, `cvv` must be |
