# Coordinate components

**Problem:** move state between components — notify an ancestor, message a
specific component, or run async work and fold in the result.

```js
// bubble — walk toward the root; the first ancestor with the handler runs
input:  { onItemClick(ctx) { ctx.bubble("itemSelected", [this]); return this; } },
bubble: { itemSelected(item, ctx) { return this.insertInLogAt(0, item.label); } },

// send / receive — deliver to one target (self, or ctx.at.<step> for another)
methods: { submit(ctx) { ctx.at.field("status").send("flash", [this.draft]); return this; } },
receive: { flash(message, ctx) { return this.setMessage(message); } },

// request / response — async host work, result routed back
receive:  { init(ctx) { ctx.request("loadData"); return this.setIsLoading(true); } },
response: { loadData(res, err, ctx) { return this.setIsLoading(false).setItems(res); } },
```

Pick by direction: **bubble** for aggregate state an ancestor owns (logs,
selections); **send/receive** to address one known component
(`ctx.at.field("x")` / `.index(name, i)` / `.key(name, k)`, default self);
**request/response** for fetch/timer/IndexedDB — register the async fn with
`scope.registerRequestHandlers({...})`, and `response` gets `(res, err)`. `ctx`
is always the trailing arg. `receive.init` is a convention, not a lifecycle
hook — dispatch it with `app.sendAtRoot("init")`.

Carry the most granular payload across the channel, not whole objects you
won't use — `ctx.bubble("itemSelected", [item.label])` over passing the entire
component. The handler then receives plain values that are easy to reproduce in
tests and storybook stories.
