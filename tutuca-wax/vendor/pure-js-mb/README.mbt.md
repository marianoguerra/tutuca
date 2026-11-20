# marianoguerra/pure-js

pure-js in MoonBit: a subset of JavaScript, and of the TypeScript that erases to
it, that is checked from the tree alone to do nothing but what its host allows,
deterministically, and to end. This is a port of the JavaScript reference
(`pure-js/lib`), held to its conformance suite and goldens: the same verdicts,
the same diagnostics, the same trees, the same printed text, the same runs,
step for step.

The stages, each its own call: `parse`, `sieve`, `check` (or `verify`, the three
at once), then `run` (the interpreter) or `print`.

## Checking a handler

A host declares what a program may name, as TypeScript text; an entry signature
says what `this` and the parameters are.

```mbt check
///|
test "a handler that checks" {
  let host = @pure-js.std_host().with_declaration({
    ..@pure-js.Declaration::empty(),
    types: [("Todo", "{ title: string; done: boolean; tags: string[] }")],
  })
  let signature : @pure-js.Signature = {
    this_: Some(@pure-js.read("Todo")),
    params: Some([@pure-js.draft("Todo"), @pure-js.plain("[string]")]),
    result: Some(@pure-js.plain("void")),
  }
  let v = @pure-js.verify(
    (
      #|function (next, [tag]) {
      #|  next.done = !this.done;
      #|  if (!this.tags.includes(tag)) next.tags.push(tag);
      #|}
    ),
    host,
    signature~,
  )
  inspect(v.diagnostics.length(), content="0")
  inspect(v.return_type.unwrap_or(""), content="void")
}
```

## What a check says

Every diagnostic has a kebab-case code, a stage, a span and, for a form pure-js
leaves out, whether it is excluded by design or omitted from this version.

```mbt check
///|
test "what is wrong, and why" {
  let host = @pure-js.std_host().with_declaration({
    ..@pure-js.Declaration::empty(),
    types: [("Counter", "{ count: number; label: string }")],
  })
  let signature : @pure-js.Signature = {
    this_: Some(@pure-js.read("Counter")),
    params: Some([@pure-js.draft("Counter")]),
    result: None,
  }
  let checked = @pure-js.verify(
    "function (next) { this.count = 1; next.label = next.count; }",
    host,
    signature~,
  )
  inspect(
    checked.diagnostics.map(d => d.code.name()).join(", "),
    content="immutable-target, not-assignable",
  )
  let excluded = @pure-js.verify("function () { while (true) {} }", host)
  inspect(excluded.diagnostics[0].code.name(), content="loop-statement")
  inspect(@pure-js.exit_code_of(excluded.diagnostics), content="1")
}
```

## Running

The interpreter takes the host's runtime: the standard host's functions, and a
fallback for the embedder's, answered by qualified name.

```mbt check
///|
test "a run and its limits" {
  let host = @pure-js.std_host()
  let v = @pure-js.verify(
    "(xs: number[]): number => xs.reduce((sum, x) => sum + x, 0)", host,
  )
  guard v.program is Some(program) else { fail("no program") }
  let xs = @pure-js.Value::List({
    items: [Num(1.0), Num(2.0), Num(3.0)],
    frozen: false,
  })
  let (outcome, _) = @pure-js.run(program, host, @pure-js.Runtime::std(), args=[
    xs,
  ])
  guard outcome is Finished(Num(sum)) else { fail("didn't finish") }
  inspect(sum, content="6")
  let (limited, _) = @pure-js.run(
    program,
    host,
    @pure-js.Runtime::std(),
    args=[xs],
    max_steps=5,
  )
  guard limited is Undefined(why) else { fail("not stopped") }
  inspect(why, content="more than 5 steps")
}
```

## Printing

```mbt check
///|
test "the program as source again" {
  guard @pure-js.parse("(a: number) => a+1") is Ok(p) else { fail("no parse") }
  inspect(@pure-js.print(p), content="a => a + 1")
  inspect(@pure-js.print(p, types=true), content="(a: number) => a + 1")
}
```
