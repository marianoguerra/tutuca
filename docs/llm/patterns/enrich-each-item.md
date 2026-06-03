# Enrich each item

**Problem:** show a value derived from each item (a count, a formatted label)
without storing it on the data.

```html
<li @each=".items" @enrich-with="enrichItem">
  <x text="@value"></x> (<x text="@count"></x> characters)
</li>
```

```js
alter: {
  enrichItem(binds, _key, item) {
    binds.count = item.length;   // becomes @count in the template
  },
}
```

`@enrich-with` receives a **mutable** `binds` object (seeded with `{ key,
value }`); every key you set becomes an `@`-prefixed binding for that item's
subtree. The return value is ignored. Combine freely with `@when` and
`@loop-with` on the same element. (Without an `@each` on the same element,
`@enrich-with` enriches the whole scope instead — see
[bind-text-and-attributes.md](bind-text-and-attributes.md).)

**Reference:** [core.md#list-iteration](../core.md#list-iteration) ·
**Runnable:** [examples/list-filter-enrich.js](../../examples/list-filter-enrich.js)
