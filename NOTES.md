# 06-10

Setup: biome config, npm install immer.js vdom.js

- Do `Null` first (constant)
- then `Str`
  - `text(field("value"))`
  - requires custom `h` and `DomNode`
  - but if `DomNode` renders all `childs` what about raw values like in `Bool`: `toNode`
  - what if too long? `displayValue`
  - but how do I see the whole thing? `title`, but dynamic: `"title": field("value")`
    - need to parse attributes and call toVal
- Do `Bool`
  - I want different classes depending on the boolean value: `"class": condVal(source("value"), "success", "error")`
    - what if they are not constants? `toVal` (make one of the classes a component attribute)
  - what if I want to show "True/False" instead of field value? `condNode`

put h and parseAttrs as View methods

---

- I want to toggle the boolean `"on:click": send("toggle")`
  - update parseAttrs startsWith("on:"), push handlers
    - if handlers data-eid, this.handlers.push
  - host.start call addEventListeners
  - handleEvent(e), getEventInfo(e, rootNode, Comp), collect eids
    look and return handler where eventName === e.target.type
  - produce, immerable
  - handleTask(new SendTask(action, e: cause))
    - action.args.eval
  - MessageContext(task)

- Do `Number` `"on:input": send("setRawValue", targetValue)`

--
