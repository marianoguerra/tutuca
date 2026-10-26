# Vendored margaui-css and margaui themes

`margaui-css.wasm` is the Tailwind CSS v4 compiler with the margaui component
library (daisyUI's class names and markup) built in, the `margaui-css.wasm`
asset of tailwindcss-moonbit's release `v0.5.0`
(https://github.com/marianoguerra/tailwindcss-moonbit/releases/tag/v0.5.0),
copied unmodified, under the MIT License (`LICENSE-tailwindcss-moonbit`). Its
SHA-256 is in `margaui-css.wasm.sha256`:
`a9958747a9fce1abe718dd58e5bc484f3e10f5459f863b1abb061dc36cbf551d`.

It exports one function, `css(classes) -> css`, and imports nothing; it needs
the engine's JS string builtins (`{ builtins: ["js-string"],
importedStringConstants: "_" }`: Node 24+, Chrome 130+, Firefox 134+, Safari
18.4+). `js/css.js` loads it.

Its output has no theme: `themes/light.css` (which also applies to `:root`)
and `themes/dark.css` (under `[data-theme="dark"]`) are margaui's, from commit
`142b397371006775e5407cc6617549f7bba4931b`
(https://github.com/marianoguerra/margaui), the commit the wasm was built
with, under the MIT License (`LICENSE-margaui`).

To update: change the release and commit in the justfile's `vendor-margaui`
recipe, run `just vendor-margaui`, which checks the wasm against its
published SHA-256, and record both here.
