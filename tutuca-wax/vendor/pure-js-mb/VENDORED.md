# pure-js-mb, vendored

pure-js's MoonBit port (`marianoguerra/pure-js` 0.2.0, the library of `~/src/mb/pure-js`),
copied unmodified by `just vendor-pure-js`: the pure-tutuca compiler (`tcd/`) parses, sieves
and checks component modules with it. It is held to the goldens of the JavaScript reference,
`../../../pure-js/test/golden`; change pure-js there, port it, then vendor it again.

Last vendored 2026-11-19 from an uncommitted checkout: an alias of a union (`type Tag = "a" |
"b"`) is its members, so `===` against one of them can be true, and a value of an alias of
strings or numbers goes to a helper that takes one, read-only or not, as it can't change (cases
`module/accept/alias-union.ts`, `module/reject-static/immutable-alias-argument.ts`). Before
that, 2026-11-18: the lexer's strings and templates keep a character past the BMP (two UTF-16
code units, an emoji) whole (case `accept/astral-strings.js`).
