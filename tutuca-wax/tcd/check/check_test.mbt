///|
fn diags_of(src : String) -> Array[String] {
  let (f, parse_diags) = @syntax.parse("t.tcd", src)
  let (_, diags) = @check.check(f, Map([]))
  let all = parse_diags.copy()
  all.append(diags)
  all.map(d => "\{d.code}: \{d.message}")
}

///|
let valid : String =
  #|package tutuca:todos@0.1.0;
  #|interface TodoItem {
  #|    field id: s32 where id >= 0;
  #|    field done: bool;
  #|    message set_done(done: bool) changes done ensures next.done == done;
  #|}
  #|component Item: TodoItem {
  #|    field id: s32 where id >= 0;
  #|    field done: bool;
  #|    field text: string where len(text) <= 200;
  #|    message set_done(done: bool) changes done ensures next.done == done;
  #|    message toggle() changes done;
  #|    view main = li(class: if(field(done), "done", "todo"), "on_click": send(toggle), field(text));
  #|}
  #|component TodoList {
  #|    field items: list<TodoItem> where len(items) <= 500;
  #|    field draft: string;
  #|    field next_id: s32 = 0 where next_id >= 0;
  #|    get remaining: s32 where remaining >= 0;
  #|    invariant ids_below: all(items, it.id < next_id);
  #|    message set_draft(text: string) changes draft ensures next.draft == text;
  #|    message add_todo() when len(draft) > 0 changes items, draft, next_id emits make TodoItem;
  #|    message move_item(from: option<index<items>>, to: option<index<items>>) changes items;
  #|    message remove_me() source_key: index<items> changes items;
  #|    message complete_all() changes nothing emits send TodoItem.set_done;
  #|    loop items { key: s32 }
  #|    view main = section(
  #|        input(value: field(draft), on_input: send(set_draft, target_value()), "on_keydown+enter+prevent": send(add_todo)),
  #|        ul(on_drop: send(move_item, drag_key(), source_key()), render_each(loop: items, field(items))),
  #|        span(field(remaining), " left"));
  #|}
  #|

///|
test "a valid package checks clean" {
  debug_inspect(diags_of(valid), content="[]")
}

///|
test "where clauses: contradictions, redundancy, what isn't a constraint, defaults" {
  debug_inspect(
    diags_of(
      (
        #|component C {
        #|    field a: s32 where a > 10 and a < 5;
        #|    field b: s32 where b > 0 and b > 5;
        #|    field c: s32 where c > 0 or c < -5;
        #|    field d: s32 = 20 where d <= 10;
        #|    field e: string where len(e) >= 1;
        #|    field f: bool where f > 1;
        #|    view main = p("x");
        #|}
      ),
    ),
    content=(
      #|[
      #|  "tcd.where.contradiction: a can never be valid: it must be at least 11 and at most 4",
      #|  "tcd.where.redundant: b > 0 is implied by b > 5",
      #|  "tcd.where.not_a_constraint: c > 0 or c < -5 isn't a constraint a schema can hold",
      #|  "tcd.field.default: the default of d, 20, doesn't meet its constraints: it must be at most 10",
      #|  "tcd.field.required: e has no default that meets its constraints, so making a component needs it",
      #|  "tcd.where.type: > compares numbers, but f is bool",
      #|]
    ),
  )
}

///|
test "make(c) defaults: of the field's type, needing no fields" {
  debug_inspect(
    diags_of(
      (
        #|interface V { }
        #|component Leaf: V { view main = p("x"); }
        #|component Other { view main = p("x"); }
        #|component Needy: V { field n: string where len(n) >= 1; view main = p("x"); }
        #|component C {
        #|    field a: V = make(Leaf);
        #|    field b: s32 = make(Leaf);
        #|    field d: V = make(nope);
        #|    field e: V = make(Other);
        #|    field f: V = make(Needy);
        #|    field g: component = make(Other);
        #|    view main = p("x");
        #|}
      ),
    ),
    content=(
      #|[
      #|  "tcd.field.required: n has no default that meets its constraints, so making a component needs it",
      #|  "tcd.field.make: make(Leaf) makes a component, but b is s32",
      #|  "tcd.field.make: no component nope to make",
      #|  "tcd.field.make: make(Other) isn't a V, the type of e",
      #|  "tcd.field.make: make(Needy) makes it with no fields, but Needy needs n",
      #|]
    ),
  )
}

///|
test "messages: guards that can't hold, ensures outside changes, unknown names" {
  debug_inspect(
    diags_of(
      (
        #|component C {
        #|    field draft: string where len(draft) <= 0;
        #|    field n: s32;
        #|    message add() when len(draft) > 0;
        #|    message bump() changes draft ensures next.n == n + 1;
        #|    message go() when cuont > 1;
        #|    view main = p(on_click: send(bump, 1), field(nn));
        #|}
      ),
    ),
    content=(
      #|[
      #|  "tcd.message.never: add can never run: its when needs len(draft) > 0, but draft must be of length at most 0, so its length must be at least 1 and at most 0",
      #|  "tcd.message.ensures_changes: the ensures of bump says how next.n relates to the state, but bump doesn't change n",
      #|  "tcd.cond.type: in the when of go: no argument, field or property cuont",
      #|  "tcd.view.send_arity: bump takes 0 arguments, this sends 1",
      #|  "tcd.view.field: C has no field or property nn; did you mean n?",
      #|]
    ),
  )
}

///|
/// A number with no default starts at 0 pulled into its bounds, as tutuca's
/// t.number().min(1) does: the nearest integer inside for an s32.
test "a bounded number with no default starts inside its bounds" {
  let (f, _) = @syntax.parse(
    "t.tcd",
    (
      #|component C {
      #|    field a: s32 where a >= 1;
      #|    field b: s32 where b > 2;
      #|    field c: s32 where c < -3;
      #|    field d: f64 where d >= 0.5;
      #|    field e: f64 where e > 0.5;
      #|    view main = p("x");
      #|}
    ),
  )
  let (pkg, _) = check(f, Map([]))
  let c = pkg.components[0]
  debug_inspect(
    c.fields.map(f => (f.name, field_default(f.ty, f.norm), f.required)),
    content=(
      #|[
      #|  ("a", Some(VNum(1)), false),
      #|  ("b", Some(VNum(3)), false),
      #|  ("c", Some(VNum(-4)), false),
      #|  ("d", Some(VNum(0.5)), false),
      #|  ("e", Some(VNum(0)), true),
      #|]
    ),
  )
}
