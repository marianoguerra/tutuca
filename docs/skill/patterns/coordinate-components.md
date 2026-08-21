# Coordinate components

**Problem:** move state between components — notify an ancestor, message a
specific component, or run async work and fold in the result.

One question picks the channel: **does the sender know who handles this?**

```js
// send / receive — YES: deliver to one target (self, or ctx.at.<step> for another)
methods: { submit(ctx) { ctx.at.field("status").send("flash", [this.draft]); return this; } },
receive: { flash(message) { return this.setMessage(message); } },

// intent on the `dyn` leg — NO: walk the ancestors; a handler that replies ends the walk
receive: { onItemClick(ctx) { ctx.intent("itemSelected", [this.label], { route: ["dyn"] }); return this; } },
intent:  { itemSelected(label) { return this.insertInLogAt(0, label); } },

// intent on the `lex` leg — NO: async host work, answered back into state
receive: {
  init(ctx) { ctx.intent("loadData", [], { route: ["lex"] }); return this.setIsLoading(true); },
  loadDataOk(items)      { return this.setIsLoading(false).setItems(items); },
  loadDataError(err)     { return this.setIsLoading(false).setError(String(err)); },
  loadDataUnhandled()    { return this.setIsLoading(false); },
},
```

**send/receive** addresses one known component (`ctx.at.field("x")` /
`.index(name, i)` / `.key(name, k)`, default self) and stops there.
**intent** names a job and walks a *route* until something answers: `["dyn"]`
up the ancestors (aggregate state — logs, selections), `["lex"]` the handlers
registered with `scope.registerIntentHandlers({...})` (fetch, timer,
IndexedDB), or the default `["dyn","lex"]` for both.

The verb no longer decides which scope answers — the route does, and it is
written at the call site where the decision actually is.

An intent answers in three named ways, each with **one** payload:
`<name>Ok`, `<name>Error`, `<name>Unhandled` (the route ran out; it carries the
intent's own args). They arrive as ordinary `receive` messages, and declaring
them is what makes an intent a *request* rather than a *notification* — declare
none and the outcome is dropped, which is the idiomatic fire-and-forget shape.

A handler that runs without calling `ctx.reply` is an **observer**: the walk
goes on. A `ctx.reply` ends it. That one rule is why there is no separate
listener bucket.

`ctx` is always the trailing arg. `receive.init` is a convention, not a
lifecycle hook — dispatch it with `app.sendAtRoot("init")`.

Carry the most granular payload across the channel, not whole objects you
won't use — `ctx.intent("itemSelected", [item.label], …)` over passing the
entire component (same reasoning as handler args: [testing.md](../testing.md)
*Designing handlers so tests stay simple*).
