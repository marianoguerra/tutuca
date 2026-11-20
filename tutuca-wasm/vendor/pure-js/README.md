# Vendored pure-js

pure-js in MoonBit (https://github.com/marianoguerra/pure-js), built: `pure-js.wasm` is its
`analyze` module (parse, sieve, check, and compile to WebAssembly), `pure-js.js` reads what it
gives, and `pure-js-run.js` runs the modules it compiles. Copied unmodified by
`../../vendor-pure-js.sh` from a checkout with its wasm built, under the MIT License (`LICENSE`).
The wasm's SHA-256 is in `pure-js.wasm.sha256`.

This copy is from commit `8d6fcb0`, the first with what tutuca-wasm needs of a compiled module
(records with a host class, the value functions a runtime links to, constants exported as
`const:<Name>`, `rawHost`).

`pure-js.wasm` needs the engine's JS string builtins and imported string constants (Node 24+,
Chrome 130+, Firefox 134+, Safari 18.4+).
