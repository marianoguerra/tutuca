---
name: jsonpointer-lab
description: Writing and fixing RFC 6901 JSON Pointers into a JSON document, with escapes, array indexes and failure reasons.
---

# JSON Pointer lab

A JSON Pointer names one value in a document. `""` is the whole document; otherwise it is a
sequence of `/`-prefixed reference tokens: `/servers/0/host` is the key `servers`, then index
`0`, then the key `host`.

Each pointer resolves to a value or fails at a segment (counted from 1):
- the object has no such key (keys are case-sensitive and compared exactly);
- the token isn't an array index (`0`, `1`, … with no leading zeros) or is out of range;
- `-` names the item after the last one, so it never resolves to a value;
- a `~` isn't followed by `0` or `1`;
- the value at that point is a string, number, boolean or null, which has no children.

Workflow:
1. Read each pointer's resolution in the summary (or `resolutions`).
2. `find(text)` to locate a key or value and get its pointer.
3. `resolve(pointer)` to try a fix, then `set_pointer`.
