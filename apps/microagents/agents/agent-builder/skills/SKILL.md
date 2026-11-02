---
name: agent-builder
description: How to build a micro-agent with the builder's tools, in order, and where the reference is.
---

# Building a micro-agent

Files in this folder:
- `contract.md`: the agent contract (folder format, query, module, tools, tutuca rules). Read
  it first.
- `tq.md`: the query language, briefly.
- `examples/starter.js`: what "New" starts from (one note part).
- `examples/logo.js` + `examples/logo-tools.json`: a turtle-graphics agent with SVG output and
  message and view tools.
- `examples/regex-lab.js` + `examples/regex-lab-tools.json`: a bigger agent with child rows,
  notifications, expectations and a lossless encode.

The builder's tools answer with the check report. Fix failures in this order: the module
loads → the samples decode and re-encode → the samples match the query → the tools line up.

A sample's text is a tdata JSON message: `{"id":"…","kind":"…","messages":[{"id":"p1","kind":"…","data":…}]}`.
In `data`, an array is written `[[1,2]]`; objects and strings are plain JSON.
