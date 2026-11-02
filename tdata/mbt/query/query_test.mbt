///|
/// Runs `q` on the message `msg`: a line per output, its JSON and its bindings' JSON.
fn outputs(q : String, msg : String) -> String raise {
  let m = @json.decode_message(msg)
  @query.run(@query.parse(q), M(m))
  .map(s => {
    let b = @model.OMap::new()
    for pair in s.bindings {
      b.push(pair.0, pair.1.to_value())
    }
    @json.encode_value(s.value.to_value()) + " " + @json.encode_value(Object(b))
  })
  .join("\n")
}

///|
let msg : String = "{\"id\":\"m\",\"kind\":\"k\",\"data\":{\"a\":[[1,2.0,3]],\"b\":{\"c\":\"x\"}}}"

///|
test "pipe binds looser than comma" {
  inspect(
    outputs(".data.a[0], .data.a[1] | . == 1", msg),
    content=(
      #|true {}
      #|false {}
    ),
  )
}

///|
test "as scopes over the rest of the pipe" {
  inspect(
    outputs(".data.b as {c: $c} | .id, $c", msg),
    content=(
      #|"m" {"c":"x"}
      #|"x" {"c":"x"}
    ),
  )
}

///|
test "a pattern can bind twice only to equal values" {
  inspect(outputs(".data.a ~ [$x, $x, ..]", msg), content="")
  inspect(
    outputs(".data.a ~ [1, 2.0, 3]", msg),
    content=(
      #|[[1,2.0,3]] {}
    ),
  )
}

///|
test "match_first stops at the first truthy output" {
  let m = @json.decode_message(msg)
  let q = @query.parse(".data.a[] | . > 1")
  guard @query.match_first(q, M(m)) is Some(s) else { fail("expected a match") }
  inspect(@json.encode_value(s.value.to_value()), content="true")
  inspect(@query.match_all(q, M(m)).length(), content="2")
}

///|
test "parse errors say where" {
  let r : Result[@query.Expr, @query.ParseError] = Ok(
    @query.parse(".data ~ {a: }"),
  ) catch {
    e => Err(e)
  }
  guard r is Err(e) else { fail("expected an error") }
  inspect(
    e.message(),
    content=(
      #|expected a pattern, found "}" at line 1, col 13
    ),
  )
}
