# Bind text and attributes

**Problem:** display a field as text, bind it to an attribute, or compose a
string from several values.

```html
<!-- text -->
<span @text=".str"></span>      <!-- into a host element -->
<x text="$getStrUpper"></x>     <!-- $ calls a method; no wrapping element -->

<!-- attributes: plain = static, :attr = dynamic -->
<input :value=".str" @on.input="$setStr value" />
<a :href=".url" :title="$'Hi {.name}'">link</a>   <!-- $'…' string template -->
<button :class="$'btn btn-{.kind}'">x</button>

<!-- derive values for a subtree without putting them on the component -->
<div @enrich-with="enrichScope">Len: <x text="@len"></x></div>
```

```js
methods: { getStrUpper() { return this.str.toUpperCase(); } },
alter:   { enrichScope() { return { len: this.text.length }; } },  // keys → @len, …
```

Value slots take `.field`, `$method`, or `@binding` — never a path
(`.user.name` fails). Multi-word strings **must** be quoted (`'flex gap-3'`) or
written as a `$'…'` template (`$'btn {.kind}'`); a bare unquoted string returns
`null`. Boolean HTML attributes (`disabled`, `checked`, …) are auto-recognized
— pass a boolean field. Scope `@enrich-with` (no `@each` on the element) is the
path-free way to expose derived values to a subtree.

**Reference:** [core.md#text-rendering](../core.md#text-rendering),
[core.md#attribute-binding](../core.md#attribute-binding),
[core.md#quoting--string-literals](../core.md#quoting--string-literals) ·
**Runnable:** [examples/text-directive.js](../../examples/text-directive.js),
[examples/attribute-binding.js](../../examples/attribute-binding.js),
[examples/render-with-scope.js](../../examples/render-with-scope.js)
