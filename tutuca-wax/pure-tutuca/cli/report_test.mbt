///|
/// Runs pure-tutuca over files in memory; what it printed to err, and its exit code.
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
  #|import { field, p } from "tutuca/view";
  #|export interface Sized { readonly size: string; }
  #|export type Box = { size: number };
  #|export const Box = {
  #|  implements: ["Sized"],
  #|  defaults: { size: 0 },
  #|  view: p({}, field("sise")),
  #|};

///|
test "check shows the lines a diagnostic is about, with its related spans" {
  let (err, code) = run_on({ "demo.tutuca.ts": twice }, [
    "check", "demo.tutuca.ts",
  ])
  inspect(code, content="1")
  inspect(
    err,
    content=(
      #|error[pure-tutuca.interface.type]: Box's size is number, but Sized's is string
      #|  ╭─[ demo.tutuca.ts:3:21 ]
      #|  │
      #|1 │ import { field, p } from "tutuca/view";
      #|2 │ export interface Sized { readonly size: string; }
      #|  │                          ──────────┬──────────
      #|  │                                    ╰─ Sized's size
      #|3 │ export type Box = { size: number };
      #|  │                     ────────────
      #|4 │ export const Box = {
      #|  ╰─
      #|error[pure-tutuca.view.field]: Box has no field or query sise; did you mean size?
      #|  ╭─[ demo.tutuca.ts:7:15 ]
      #|  │
      #|6 │   defaults: { size: 0 },
      #|7 │   view: p({}, field("sise")),
      #|  │               ─────────────
      #|8 │ };
      #|  ╰─
      #|
    ),
  )
}

///|
test "check --short writes one line per diagnostic" {
  let (err, _) = run_on({ "demo.tutuca.ts": twice }, [
    "check", "demo.tutuca.ts", "--short",
  ])
  inspect(
    err,
    content=(
      #|demo.tutuca.ts:3:21: error[pure-tutuca.interface.type]: Box's size is number, but Sized's is string
      #|demo.tutuca.ts:7:15: error[pure-tutuca.view.field]: Box has no field or query sise; did you mean size?
      #|
    ),
  )
}

///|
test "a clean check prints nothing" {
  let (err, code) = run_on(
    {
      "demo.tutuca.ts": (
        #|import { field, p } from "tutuca/view";
        #|export type Box = { size: number };
        #|export const Box = { defaults: { size: 0 }, view: p({}, field("size")) };
      ),
    },
    ["check", "demo.tutuca.ts"],
  )
  inspect(code, content="0")
  inspect(err, content="")
}
