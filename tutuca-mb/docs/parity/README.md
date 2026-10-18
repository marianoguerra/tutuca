# Parity with the JS tutuca

Every test in the JS repository's `test/` directory is mapped to the MoonBit port. Each one is
either **ported**, an equivalent MoonBit test (or a jsdom smoke assertion for browser-only
behaviour); **by types**, the compiler rejects what it guards against; or **divergent**, a
deliberate difference with its reason. A parameterized test site counts once.

| JS suites | Doc | Tests | Ported | By types | Divergent | Missing |
|---|---|---|---|---|---|---|
| test/core | [core.md](core.md) | 78 | 55 | 18 | 5 | 0 |
| test/paths, test/vdom, test/lint, test/pbt | [paths-vdom-lint-pbt.md](paths-vdom-lint-pbt.md) | 93 | 70 | 16 | 7 | 0 |
| test/dev, test/storybook, test/components, test/demos | [dev-storybook-components.md](dev-storybook-components.md) | 89 | 87 | 0 | 2 | 0 |
| test/playground, test/site | [playground.md](playground.md) | 19 | 8 | 1 | 10 | 0 |
| **Total** | | **279** | **220** | **35** | **24** | **0** |

The JS suites have 225 test sites (`npm test` runs them as 608 tests, since some sites are
loops). The docs count a parameterized site once or per case, as each says, which gives the
279 above.

**Checked against the JS files themselves.** `just parity` (`scripts/parity-check.mjs`, part of
`just ci`) reads `../test/**/*.test.js`: every `test(...)`/`it(...)` site, and every
`testLintsClean`/`testGenericProperties` helper call, must match a row here. A template title's
`${...}` parts are wildcards. Every row marked ported must also name a MoonBit test that exists
(a `test "..."` title, with `{a,b}` and `[optional]` expanded), a smoke-script check, or a test
file. Renaming a referenced MoonBit test, or dropping a row, makes it fail.

**Stories, by id.** Each JS story is a JS test three times over (`${story.id} starts valid and
renders`, `${story.id} sequences pass` and its stress test), so `just parity` also compares the
stories themselves: it imports every `components/*/stories.js` in node and reads their books'
ids ("book title/story name"), and runs `moon run --target js examples/storybook/ids`, which
prints the id of every story of the storybook page's books. Every JS id must be a port story,
with the same initial state, sequences (steps and checks), stress targets (JS `pbt.include`, or
message targets for `events: true`) and `max_steps` (JS `pbt.maxCommands`, 20 by default); the
port runs them all with `check_books(..., stress=20)` in each stories package and in real
Chromium (`scripts/browser-check.mjs`). Every port id must be a JS id too, or be listed below
with its reason. Today the 118 ids match one to one.

As JS's `sendAt`, `send_to` delivers to the component the last render placed at the target's
path, so its notifications bubble through the components rendered around it (a JsonSelector's
`setTo` is answered by its JsonValue). The JSON stress runs send it too: `@testing.lens_messages`
targets every value still to be chosen through the lenses its selector renders at, as JS's
valueMessages go to any JsonSelector instance.

### Port-only stories

None: every port story is a JS story. Add one as "- `Book/Story`: why it has no JS counterpart".

Most divergent rows follow from MoonBit's model:
- **Components are values.** There is no registry or factories.
- **Messages are typed.** Arg schemas and `emits` have no counterpart.
- **A playground run compiles one package.** The JS module-graph tests have nothing to test.

The README's "Intentional differences" section lists the deliberate behaviour differences.

Verify everything with `just ci`. Besides the parity check, it runs `moon test` on wasm-gc, js and native, and the jsdom
smoke scripts for the todo demo (js and wasm-gc), the storybook, every demo, the
`<tutuca-app>` element and the playground, which compiles every example and component
library in the browser compiler.
