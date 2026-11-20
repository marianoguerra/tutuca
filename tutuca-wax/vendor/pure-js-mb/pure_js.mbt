// pure-js: a subset of JavaScript (and of the TypeScript that erases to it)
// that can be checked to do nothing but what its host allows,
// deterministically, and to end. The stages, each its own call: parse, sieve,
// check, then run (the interpreter) or print. A port of the JavaScript
// reference, held to its conformance goldens.

///|
/// Parses one program.
pub fn parse(source : String) -> Result[@ast.Program, @diag.Diagnostic] {
  @parser.parse(source)
}

///|
/// The tree as the reference's goldens record it.
pub fn tree_json(program : @ast.Program) -> Json {
  @ast.to_json(program)
}

///|
pub using @check {type Signature, type Entry, type Mode, read, draft, plain}

///|
pub using @host {type Host, type Declaration, std_host, std_declaration}

///|
pub using @diag {type Diagnostic, exit_code_of, format, format_all}

///|
/// What verifying a program found: the program (None when it doesn't parse),
/// the diagnostics, and what it returns (None when it didn't get as far as
/// the checker).
pub struct Verified {
  program : @ast.Program?
  diagnostics : Array[@diag.Diagnostic]
  return_type : String?
}

///|
/// Parse, sieve and check.
pub fn verify(
  source : String,
  host : @host.Host,
  signature? : @check.Signature,
  profile~ : String = "core",
  deterministic~ : Bool = false,
) -> Verified raise Failure {
  match @parser.parse(source) {
    Err(d) => { program: None, diagnostics: [d], return_type: None, }
    Ok(program) => {
      let sieved = @sieve.sieve(program, profile~)
      if sieved.length() > 0 {
        return {
          program: Some(program),
          diagnostics: sieved,
          return_type: None,
        }
      }
      let checked = @check.check(program, host, signature?, deterministic~)
      {
        program: Some(program),
        diagnostics: checked.diagnostics,
        return_type: Some(checked.return_type),
      }
    }
  }
}

///|
pub using @value {
  type Value,
  type RunError,
  type ListRef,
  type ObjRef,
  type HandleRef,
  from_json,
  to_json,
  deep_freeze,
  stringify,
}

///|
pub using @eval {type Runtime, type Outcome}

///|
/// Runs a checked program with the interpreter: how it ended, and how many
/// steps it took.
pub fn run(
  program : @ast.Program,
  host : @host.Host,
  runtime : @eval.Runtime,
  this_~ : @value.Value = Undefined,
  args~ : Array[@value.Value] = [],
  max_steps~ : Int32 = 1_000_000,
  max_depth~ : Int32 = 1000,
) -> (@eval.Outcome, Int32) {
  @eval.run(program, host, runtime, this_~, args~, max_steps~, max_depth~)
}

///|
/// The program as source again; with types, TypeScript.
pub fn print(program : @ast.Program, types~ : Bool = false) -> String {
  @write.print(program, types~)
}

///|
/// The program without its type annotations.
pub fn erase(program : @ast.Program) -> @ast.Program {
  program.erase()
}

///|
/// The sieve on its own.
pub fn sieve(
  program : @ast.Program,
  profile~ : String = "core",
) -> Array[@diag.Diagnostic] raise Failure {
  @sieve.sieve(program, profile~)
}

///|
/// Parses a module.
pub fn parse_module(source : String) -> Result[@ast.Module, @diag.Diagnostic] {
  @parser.parse_module(source)
}

///|
/// The module as the reference's goldens record it.
pub fn module_tree_json(m : @ast.Module) -> Json {
  @ast.module_json(m)
}

///|
pub using @check {
  type ModuleChecked,
  type ModuleEntry,
  type Summary,
  type TypeEntry,
  type Binding,
  is_namespace_literal,
  entries_of,
}

///|
/// What verifying a module found: the module (None when it doesn't parse),
/// the diagnostics, and (when it got as far as the checker) what checking it
/// gave.
pub struct ModuleVerified {
  module_ : @ast.Module?
  diagnostics : Array[@diag.Diagnostic]
  checked : @check.ModuleChecked?
}

///|
/// Parse, sieve (the module profile) and check a module. resolve gives
/// another module's source by specifier, signature_of the signature of the
/// entry at a path.
pub fn verify_module(
  source : String,
  host : @host.Host,
  resolve? : (String) -> String?,
  signature_of~ : (Array[String]) -> @check.Signature? = _ => None,
  data_type_of~ : (Array[String]) -> String? = _ => None,
  deterministic~ : Bool = false,
) -> ModuleVerified raise Failure {
  match @parser.parse_module(source) {
    Err(d) => { module_: None, diagnostics: [d], checked: None, }
    Ok(m) => {
      let sieved = @sieve.sieve_module(m, profile="module")
      if sieved.length() > 0 {
        return { module_: Some(m), diagnostics: sieved, checked: None, }
      }
      let checked = @check.check_module(
        m,
        host,
        resolve?,
        signature_of~,
        data_type_of~,
        deterministic~,
      )
      {
        module_: Some(m),
        diagnostics: checked.diagnostics,
        checked: Some(checked),
      }
    }
  }
}

///|
pub using @eval {type Instance, instantiate, run_entry}

///|
/// The module as source again; with types, TypeScript; without, without its
/// type items.
pub fn print_module(m : @ast.Module, types~ : Bool = false) -> String {
  @write.print_module(m, types~)
}

///|
/// The module's sieve on its own.
pub fn sieve_module(
  m : @ast.Module,
  profile~ : String = "core",
) -> Array[@diag.Diagnostic] raise Failure {
  @sieve.sieve_module(m, profile~)
}

///|
/// A type as TypeScript writes it.
pub fn type_text(t : @types.Ty) -> String {
  @types.type_to_string(t)
}

///|
/// A type node as TypeScript writes it.
pub fn print_type(t : @ast.TypeNode) -> String {
  @write.print_type(t)
}
