// The three mistakes JS's linter reports, which in MoonBit are the compiler's: Run shows
// them here, underlined. This file is not part of the package `moon test` checks
// (examples/site/mistakes/broken has no moon.pkg); the playground compiles it with
// mistakes.mbt, and scripts/smoke-playground.mjs checks the compiler reports these three.

///|
pub fn greeting_card() -> @tutuca.View[Greeting, GreetingMsg] {
  div([cls("flex flex-col gap-2")], [
    // Mistake 1: the field is name, not nmae.
    h3([], [txt("Hello, "), show(s => s.nmae)]),
    // Mistake 2: Rename takes the new name, and this sends none.
    button([cls("btn"), on_click(Rename)], [txt("Rename")]),
    // Mistake 3: there is no Reset message.
    button([cls("btn btn-ghost"), on_click(Reset)], [txt("Reset")]),
  ])
}
