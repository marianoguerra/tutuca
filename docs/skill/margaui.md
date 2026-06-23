# Tutuca — MargaUI Styling

Reach this file to add **MargaUI** (the Tailwind v4 / daisyUI-compatible
class library) styling to a tutuca app: get margaui into the project,
link its theme, and let tutuca's extra build compile the utility classes
it finds in your views into CSS. If you only need scoped/global component
CSS, the `## Styles` section in [core.md](./core.md) is enough.

## Get margaui

margaui ships two pieces: a `compile` function (class names → CSS text)
and a `theme.css` stylesheet. Pick one of three ways to obtain them.

### CDN (no install)

Nothing to install — import from jsDelivr and link the theme. tutuca's
extra build is on the CDN too:

```html
<link
  rel="stylesheet"
  href="https://marianoguerra.github.io/margaui/themes/theme.css"
/>
<script type="module">
  import { compile } from "https://cdn.jsdelivr.net/npm/margaui/+esm";
  import {
    compileClassesToStyleText,
    injectCss,
    tutuca,
  } from "https://cdn.jsdelivr.net/npm/tutuca/dist/tutuca-extra.js/+esm";
  // …wire it up (see below)
</script>
```

See `docs/examples/getting-started-margaui.html` for a complete runnable page.

### npm

Install both as dev dependencies and import via bare specifiers:

```sh
npm i --save-dev tutuca margaui
```

```js
import { compileClassesToStyleText, injectCss, tutuca } from "tutuca/extra";
import { compile } from "margaui";
```

Serve or copy the theme from `node_modules/margaui` into your build, or
keep linking the GitHub Pages `theme.css` shown above.

### Vendoring

Copy a prebuilt `margaui.min.js` and a `theme.css` into the project and
import from the local path — useful for offline builds or pinning an
exact version (this repo vendors `docs/deps/margaui.min.js` for exactly
that reason):

```html
<link rel="stylesheet" href="./vendor/theme.css" />
<script type="module">
  import { compile } from "./vendor/margaui.min.js";
  // …
</script>
```

Trade-off: no runtime network dependency and a frozen version, at the
cost of updating the vendored files by hand.

## Wire it into tutuca

However you obtained `compile`, the integration is the same: register
your components, compile the classes their views reference, inject the
resulting CSS, then start.

```js
import { compileClassesToStyleText, injectCss, tutuca } from "tutuca/extra";
import { compile } from "margaui"; // or the CDN / vendored path

const app = tutuca("#app");
app.registerComponents([Comp]);
const css = await compileClassesToStyleText(app, compile);
injectCss("myapp", css);
app.start();
```

`compileClassesToStyleText` walks every registered component's templates,
collects the `class=` and `:class=` literals, hands them to a `compile`
function (any margaui-compatible signature), and returns CSS text. Pair
with `injectCss(scopeName, css)` to install the result before `start()`.

When authoring class lists, load the margaui skill alongside this one if
available (`npx tutuca install-skill --margaui-skill`) — it lists the
available components and their canonical class strings, which is what the
`compile` step expects.

## Pitfall: @if.class is invisible to the scanner

Classes inside `@then` / `@else` (e.g.
`@if.class=".active" @then="'btn-success'" @else="'btn-ghost'"`) are not
literals in `class=` / `:class=`, so `compileClassesToStyleText` skips
them and the margaui CSS for those classes is never emitted — the
conditional class renders unstyled. Workaround: add a hidden "decoy" view
on the component that lists every conditional class as a real literal, so
the walker picks them up:

```js
_margauiClasses: html`<p class="btn-success btn-ghost on off"></p>`,
```

The view does not need to be rendered anywhere — registration is enough
for the template walker to find it. (This is the same rule
[component-design.md](./component-design.md) gives for runtime-assembled
margaui classes.)

## See also

- [core.md](./core.md) — `## Styles` for scoped/global component CSS.
- [advanced.md](./advanced.md) — dynamic bindings, drag & drop, custom
  seq types, and other advanced view features.
- [cli.md](./cli.md) — `tutuca storybook` wires margaui by default
  (`--no-margaui` to skip); `install-skill --margaui-skill` installs the
  margaui skill.
