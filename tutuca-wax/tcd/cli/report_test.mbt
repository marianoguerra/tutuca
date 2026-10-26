///|
/// Runs tcd over files in memory; what it printed to err, and its exit code.
fn run_on(files : Map[String, String], args : Array[String]) -> (String, Int32) {
  let err = StringBuilder()
  let io : @cli.Io = {
    read: p => files.get(p),
    write: (_, _) => true,
    write_bytes: (_, _) => true,
    out: _ => (),
    err: s => err.write_string(s),
    color: false,
  }
  let code = @cli.run(args, io)
  (err.to_string(), code)
}

///|
let twice : String =
  #|package demo;
  #|
  #|component box {
  #|    field size: s32;
  #|    field size: s32;
  #|    view main = p(field(sise));
  #|}

///|
test "check shows the lines a diagnostic is about, with its related spans" {
  let (err, code) = run_on({ "demo.tcd": twice }, ["check", "demo.tcd"])
  inspect(code, content="1")
  inspect(
    err,
    content=(
      #|error[tcd.name.duplicate]: there's already a field or property named size
      #|  ╭─[ demo.tcd:5:11 ]
      #|  │
      #|3 │ component box {
      #|4 │     field size: s32;
      #|  │           ─┬──
      #|  │            ╰─ the first one
      #|5 │     field size: s32;
      #|  │           ────
      #|6 │     view main = p(field(sise));
      #|  ╰─
      #|error[tcd.view.field]: box has no field or property sise; did you mean size?
      #|  ╭─[ demo.tcd:6:25 ]
      #|  │
      #|5 │     field size: s32;
      #|6 │     view main = p(field(sise));
      #|  │                         ────
      #|7 │ }
      #|  ╰─
      #|
    ),
  )
}

///|
test "check --short writes one line per diagnostic" {
  let (err, _) = run_on({ "demo.tcd": twice }, ["check", "demo.tcd", "--short"])
  inspect(
    err,
    content=(
      #|demo.tcd:5:11: error[tcd.name.duplicate]: there's already a field or property named size
      #|demo.tcd:6:25: error[tcd.view.field]: box has no field or property sise; did you mean size?
      #|
    ),
  )
}

///|
test "a clean check prints nothing" {
  let (err, code) = run_on(
    {
      "demo.tcd": (
        #|package demo;
        #|
        #|component box {
        #|    field size: s32;
        #|    view main = p(field(size));
        #|}
      ),
    },
    ["check", "demo.tcd"],
  )
  inspect(code, content="0")
  inspect(err, content="")
}
