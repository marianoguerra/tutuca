///|
/// The normal form of `where w` on a subject x of type ty, in words, and the
/// codes of what it reported.
fn norm_of(w : String, ty : @check.Ty) -> String {
  let (f, _) = @syntax.parse(
    "t.tcd",
    "component c { field x: s32 where \{w}; view main = p(); }",
  )
  guard f.items[0] is Component(d) && d.members[0] is Field(field) else {
    return "not parsed"
  }
  let diags = []
  let n = @check.normalize(
    field.where_,
    "x",
    ty,
    Map::from_array([("xs", @check.Ty::List(S32)), ("m", Map(Str))]),
    diags,
  )
  let codes = diags.map(d => d.code)
  if codes.is_empty() {
    @check.norm_text(n)
  } else {
    "\{@check.norm_text(n)} \{codes.join(", ")}"
  }
}

///|
test "where clauses in normal form" {
  let s32 : @check.Ty = S32
  let cases = [
    ("x >= 0", s32),
    ("0 <= x < 100", s32),
    ("x > 1.5", s32),
    ("x > 1.5", F64),
    ("10 >= x", s32),
    ("x != 3 and x in [1, 2, 3]", s32),
    ("len(x) >= 1 and len(x) < 10", Str),
    ("x matches \"^[a-z]+$\"", Str),
    ("x in keys(xs)", s32),
    ("x in keys(m)", Str),
    ("x in values(xs)", s32),
    ("check(even)", s32),
  ]
  debug_inspect(
    cases.map(c => "\{c.0} => \{norm_of(c.0, c.1)}"),
    content=(
      #|[
      #|  "x >= 0 => at least 0",
      #|  "0 <= x < 100 => at least 0 and at most 99",
      #|  "x > 1.5 => at least 2",
      #|  "x > 1.5 => above 1.5",
      #|  "10 >= x => at most 10",
      #|  "x != 3 and x in [1, 2, 3] => one of 1, 2, 3 and none of 3",
      #|  "len(x) >= 1 and len(x) < 10 => of length at least 1 and of length at most 9",
      #|  "x matches \"^[a-z]+$\" => matching \"^[a-z]+$\"",
      #|  "x in keys(xs) => a key of xs",
      #|  "x in keys(m) => a key of m",
      #|  "x in values(xs) => one of the values of xs",
      #|  "check(even) => satisfying even",
      #|]
    ),
  )
}

///|
test "where clauses that can't be, or say twice, or aren't constraints" {
  let s32 : @check.Ty = S32
  let cases = [
    ("x > 10 and x < 5", s32),
    ("x > 3 and x < 4", s32),
    ("x in [1, 2] and x in [3]", s32),
    ("x == 1 and x != 1", s32),
    ("len(x) > 5 and len(x) < 3", Str),
    ("x > 0 and x > 5", s32),
    ("x < 5 and x < 9", s32),
    ("x > 0 or x < -5", s32),
    ("not x > 1", s32),
    ("y > 1", s32),
    ("x > y", s32),
    ("len(x) > 1", s32),
    ("x matches \"a\"", s32),
    ("x in keys(nope)", s32),
    ("x in keys(m)", s32),
  ]
  debug_inspect(
    cases.map(c => "\{c.0} => \{norm_of(c.0, c.1)}"),
    content=(
      #|[
      #|  "x > 10 and x < 5 => at least 11 and at most 4 tcd.where.contradiction",
      #|  "x > 3 and x < 4 => at least 4 and at most 3 tcd.where.contradiction",
      #|  "x in [1, 2] and x in [3] => one of  tcd.where.contradiction",
      #|  "x == 1 and x != 1 => one of 1 and none of 1 tcd.where.contradiction",
      #|  "len(x) > 5 and len(x) < 3 => of length at least 6 and of length at most 2 tcd.where.contradiction",
      #|  "x > 0 and x > 5 => at least 6 tcd.where.redundant",
      #|  "x < 5 and x < 9 => at most 4 tcd.where.redundant",
      #|  "x > 0 or x < -5 => anything of its type tcd.where.not_a_constraint",
      #|  "not x > 1 => anything of its type tcd.where.not_a_constraint",
      #|  "y > 1 => anything of its type tcd.where.not_a_constraint",
      #|  "x > y => anything of its type tcd.where.not_a_constraint",
      #|  "len(x) > 1 => anything of its type tcd.where.type",
      #|  "x matches \"a\" => anything of its type tcd.where.type",
      #|  "x in keys(nope) => anything of its type tcd.where.unknown_field",
      #|  "x in keys(m) => anything of its type tcd.where.type",
      #|]

    ),
  )
}

///|
test "names in three spellings" {
  debug_inspect(
    [
      (
        @check.camel("set_text"),
        @check.pascal("json_number"),
        @check.wax("type"),
      ),
      (@check.camel("x"), @check.pascal("a_b_c"), @check.wax("count")),
    ],
    content=(
      #|[("setText", "JsonNumber", "type_"), ("x", "ABC", "count")]
    ),
  )
  debug_inspect(
    [
      @check.is_snake_case("ok_1"),
      @check.is_snake_case("NotOk"),
      @check.is_snake_case("_x"),
    ],
    content="[true, false, false]",
  )
  debug_inspect(
    @check.closest("cuont", ["count", "draft"]),
    content="Some(\"count\")",
  )
}
