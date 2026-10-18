// 2. A todo list: a collection, a loop, form inputs and a computed value.
// each(...) repeats a view per item; the item's handlers send messages with its index.

///|
using @tutuca {
  div,
  form,
  input,
  button,
  label,
  p,
  ul,
  li,
  span,
  txt,
  show,
  cls,
  aria,
  attr,
  value,
  checked,
  if_,
  each,
  on_input,
  on_submit,
  on_event,
  type Vec,
}

///|
pub(all) struct Todo {
  title : String
  done : Bool
} derive(Eq, Debug, ToJson, FromJson, @quickcheck.Arbitrary)

///|
pub(all) struct TodoList {
  text : String
  items : Vec[Todo]
} derive(Eq, Debug, ToJson, FromJson, @quickcheck.Arbitrary)

///|
/// A computed value is a method: the view calls it like any other function.
pub fn TodoList::left(self : TodoList) -> Int32 {
  self.items.count(t => !t.done)
}

///|
pub(all) enum TodoListMsg {
  SetText(String)
  Add
  Toggle(Int32)
  Remove(Int32)
} derive(Debug, ToJson, FromJson, @quickcheck.Arbitrary)

///|
fn TodoList::view() -> @tutuca.View[TodoList, TodoListMsg] {
  div([cls("flex max-w-sm flex-col gap-3")], [
    form([cls("join"), on_submit(Add)], [
      // on_input sends the field's value with each keystroke.
      input([
        cls("input join-item"),
        attr("placeholder", "What needs doing?"),
        aria("label", "New item"),
        value(s => s.text),
        on_input(v => SetText(v)),
      ]),
      button([cls("btn btn-primary join-item")], [txt("Add")]),
    ]),
    if_(
      s => s.items.is_empty(),
      p([cls("opacity-60")], [txt("Nothing to do.")]),
      ul([cls("flex flex-col gap-1")], [
        // Inside the loop, `it.value` is the item and `it.index` its index.
        each(
          s => s.items.iter(),
          li([cls("flex items-center gap-2")], [
            label([cls("flex flex-1 items-center gap-2")], [
              input([
                attr("type", "checkbox"),
                cls("checkbox checkbox-sm"),
                checked(it => it.value.done),
                on_event(Change, (it, _) => Some(Toggle(it.index))),
              ]),
              span([], [show(it => it.value.title)]),
            ]),
            button(
              [
                cls("btn btn-xs btn-ghost"),
                aria("label", "Remove"),
                on_event(Click, (it, _) => Some(Remove(it.index))),
              ],
              [txt("✕")],
            ),
          ]),
        ),
      ]),
    ),
    p([cls("text-sm opacity-60")], [show(s => "\{s.left()} left")]),
  ])
}

///|
fn TodoList::update(
  self : TodoList,
  msg : TodoListMsg,
  _ctx : @tutuca.Ctx[TodoList, TodoListMsg],
) -> TodoList {
  let has = (i : Int32) => i >= 0 && i < self.items.length()
  match msg {
    SetText(text) => { ..self, text, }
    Add => {
      let title = self.text.trim().to_owned()
      guard title != "" else { self }
      { text: "", items: self.items.push({ title, done: false, }), }
    }
    Toggle(i) if has(i) =>
      { ..self, items: self.items.update(i, t => { ..t, done: !t.done, }), }
    Remove(i) if has(i) => { ..self, items: self.items.remove(i), }
    Toggle(_) | Remove(_) => self
  }
}

///|
pub let todo_list : @tutuca.Component[TodoList, TodoListMsg] = @tutuca.component(
  "TodoList",
  view=TodoList::view,
  update=TodoList::update,
)

///|
let new_item : @storybook.Find = @storybook.find(
  "input",
  attr=("aria-label", "New item"),
)

///|
pub fn[N : @vdom.DomNode] books() -> Array[@storybook.Book[N]] {
  [
    @storybook.book("Todo list", [
      @storybook.story(
        "Empty",
        todo_list,
        () => { text: "", items: Vec::new(), },
        sequences=[
          (
            "add two, finish one",
            [
              @storybook.event("input", new_item, value="Buy milk"),
              @storybook.event("submit", @storybook.find("form")),
              @storybook.event("input", new_item, value="Write docs"),
              @storybook.event("submit", @storybook.find("form")),
              @storybook.event(
                "change",
                @storybook.find("input", attr=("type", "checkbox")),
                value="true",
              ),
              @storybook.check("one left", s => {
                s.left() == 1 && s.items.length() == 2
              }),
            ],
          ),
        ],
        targets=[@testing.root_messages()],
      ),
      @storybook.story("A few items", todo_list, () => {
        text: "",
        items: Vec::of([
          { title: "Read the guide", done: true, },
          { title: "Edit this example", done: false, },
        ]),
      }),
    ]),
  ]
}
