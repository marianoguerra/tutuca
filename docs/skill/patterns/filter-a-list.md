# Filter a list

**Problem:** render only the items that match a condition.

```html
<li @each=".items" @when="filterItem">
  <span @text="@key"></span>: <x text="@value"></x>
</li>
<!-- on <x render-each> the prefix drops: when="filterItem" -->
```

```js
alter: {
  filterItem(_key, item) {
    return item.toLowerCase().includes(this.query.toLowerCase());
  },
}
```

`@when` names an `alter` handler called per item as `(key, value, iterData)`;
return `false` to skip. It filters *after* any `@loop-with` slice, so a page
can yield fewer than its window. Filtering reads other fields off `this`
directly (`this.query`) — there are no paths in the template. To filter
*before* paging, return `keys` from `@loop-with` instead — see
[filter-and-paginate.md](filter-and-paginate.md).
