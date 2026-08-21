# Tabbed interface

**Problem:** build tabs — a single `currentView` field decides which panel
shows, and the active tab button is highlighted.

```html
<div role="tablist" class="tabs">
  <button
    role="tab"
    @if.class="equals? .currentView 'overview'"
    @then="'tab tab-active'"
    @else="'tab'"
    @on.click="selectView 'overview'"
  >Overview</button>
  <button
    role="tab"
    @if.class="equals? .currentView 'pricing'"
    @then="'tab tab-active'"
    @else="'tab'"
    @on.click="selectView 'pricing'"
  >Pricing</button>
</div>

<div @show="equals? .currentView 'overview'">…overview…</div>
<div @show="equals? .currentView 'pricing'">…pricing…</div>
```

```js
fields: { currentView: "overview" },
receive: {
  selectView(draft, view) {
    draft.currentView = view;
  },
},
```

One string field is the whole state machine. `equals? .currentView 'overview'`
drives both the panel's `@show` and the active-tab class via `@if.class` /
`@then` / `@else`. Tab clicks call the draft recipe with a string-literal
argument (`@on.click="selectView 'pricing'"`). This toggles
**sibling panels** by predicate; to swap a *component's own* rendered view
instead, see the switch-between-views recipe. The field name is yours to pick
(`tab`, `currentView`, …).
