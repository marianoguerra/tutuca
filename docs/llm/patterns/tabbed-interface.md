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
    @on.click="$setCurrentView 'overview'"
  >Overview</button>
  <button
    role="tab"
    @if.class="equals? .currentView 'pricing'"
    @then="'tab tab-active'"
    @else="'tab'"
    @on.click="$setCurrentView 'pricing'"
  >Pricing</button>
</div>

<div @show="equals? .currentView 'overview'">…overview…</div>
<div @show="equals? .currentView 'pricing'">…pricing…</div>
```

```js
fields: { currentView: "overview" },   // $setCurrentView is auto-generated
```

One string field is the whole state machine. `equals? .currentView 'overview'`
drives both the panel's `@show` ([show-or-hide-content.md](show-or-hide-content.md))
and the active-tab class via `@if.class` / `@then` / `@else`
([conditional-attribute-value.md](conditional-attribute-value.md)). Tab clicks
call the auto-generated setter with a string-literal arg
(`@on.click="$setCurrentView 'pricing'"`). This toggles **sibling panels** by
predicate; to swap a *component's own* rendered view instead, see
[switch-between-views.md](switch-between-views.md).

> The runnable example names the field `tab` rather than `currentView` — the
> field name is yours to pick.

**Reference:** [core.md#conditional-display](../core.md#conditional-display) ·
**Runnable:** [examples/tabbed-ui.js](../../examples/tabbed-ui.js)
