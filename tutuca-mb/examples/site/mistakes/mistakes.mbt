// 5. When things go wrong. In MoonBit most mistakes never get to run: the compiler catches
// them. typos.mbt, the other file, has the three mistakes JS's linter finds (a field that
// doesn't exist, a message sent without its argument, a message nobody handles), and Run
// shows the compiler's errors in the editor. Fix them, or empty that file, and run again.
//
// What types can't rule out, Component::check() reports. This component has three such
// mistakes: the story shows a badge with their count, and the Dev panel lists them with
// where each one is. Fix them here and press Ctrl+Enter.

///|
using @tutuca {div, h3, p, button, txt, show, cls, on, on_click}

///|
pub(all) struct Greeting {
  name : String
  greetings : Int32
} derive(Eq, Debug, ToJson, FromJson, @quickcheck.Arbitrary)

///|
pub(all) enum GreetingMsg {
  Greet
  Rename(String)
} derive(Debug, ToJson, FromJson, @quickcheck.Arbitrary)

///|
pub let greeting : @tutuca.Component[Greeting, GreetingMsg] = @tutuca.component(
  "Greeting",
  view=() => {
    div([cls("flex flex-col gap-2")], [
      h3([cls("text-xl")], [txt("Hello, "), show(s => s.name), txt("!")]),
      p([], [
        txt("Greeted "),
        show(s => s.greetings.to_string()),
        txt(" times."),
      ]),
      div([cls("flex gap-2")], [
        button([cls("btn btn-primary"), on_click(Greet)], [txt("Greet")]),
        // Mistake 1: "clik" is no DOM event, so this handler would never run.
        button([cls("btn"), on(Custom("clik"), Rename("Ada"))], [txt("Rename")]),
        // Mistake 2: class is set twice; join them into one cls(...).
        // Mistake 3: two click handlers; only one runs.
        button(
          [
            cls("btn"),
            cls("btn-ghost"),
            on_click(Greet),
            on_click(Rename("World")),
          ],
          [txt("Reset")],
        ),
      ]),
    ])
  },
  update=(s, msg, _) => {
    match msg {
      Greet => { ..s, greetings: s.greetings + 1, }
      Rename(name) => { ..s, name, }
    }
  },
)

///|
pub fn[N : @vdom.DomNode] books() -> Array[@storybook.Book[N]] {
  [
    @storybook.book("Mistakes", [
      @storybook.story(
        "Greeting",
        greeting,
        () => { name: "World", greetings: 0, },
        sequences=[
          (
            "greet twice",
            [
              @storybook.event("click", @storybook.find("button", text="Greet")),
              @storybook.event("click", @storybook.find("button", text="Greet")),
              @storybook.check("greeted twice", s => s.greetings == 2),
            ],
          ),
        ],
      ),
    ]),
  ]
}
