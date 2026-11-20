// A module, made, as the reference's instantiate and runEntry: its helpers
// first, then its imports, then its constants in the order they're written,
// each frozen; a namespace is a frozen object of its data members, and its
// methods and getters are entries, run by path.

///|
/// An entry of a made module: the function, whether it is a getter, and the
/// module's frame it runs in.
priv struct EntryFn {
  func : @ast.Func
  getter : Bool
  frame : Frame
}

///|
/// A made module.
pub struct Instance {
  priv interp : Interp
  priv entries : Map[String, EntryFn]
  /// Its namespaces' data, and its other constants, by name.
  namespaces : Map[String, Value]
  consts : Map[String, Value]
  /// What it exports, for the modules that import it.
  exports : Map[String, Value]
}

///|
fn is_namespace(e : @ast.Expr) -> Bool {
  match e {
    ObjectLit(members, ..) =>
      members
      .iter()
      .any(m => {
        match m {
          Method(..) => true
          Prop(value~, ..) => is_namespace(value)
          _ => false
        }
      })
    _ => false
  }
}

///|
/// A helper, as a name refers to it: one step for the call, as deep as
/// callbacks may nest.
fn Interp::helper(self : Interp, f : @ast.Func, frame : Frame) -> Value {
  Fn({
    call: args => {
      self.step()
      self.depth += 1
      if self.depth > self.max_depth {
        raise Limit("calls nested more than \{self.max_depth} deep")
      }
      errdefer {
        self.depth -= 1
      }
      let result = self.call_function(f, Undefined, args, Some(frame))
      self.depth -= 1
      result
    },
  })
}

///|
/// A module's constant: a frozen value, or a namespace, whose entries go in
/// entries by path.
fn Interp::constant(
  self : Interp,
  init : @ast.Expr,
  frame : Frame,
  path : String,
  entries : Map[String, EntryFn],
) -> Value raise RunError {
  guard init is ObjectLit(members, ..) && is_namespace(init) else {
    return @value.deep_freeze(self.expr(init, frame))
  }
  let props : Map[String, Value] = Map([])
  for m in members {
    match m {
      Method(key~, func~, getter~, ..) => {
        let k = match key {
          KIdent(id) => id.name
          KLit(LStr(s), ..) => s
          KLit(_, raw~, ..) => raw
          KComputed(_) => ""
        }
        entries["\{path}.\{k}"] = { func, getter, frame, }
      }
      Prop(key~, value~, ..) => {
        let k = match key {
          KIdent(id) => id.name
          KLit(LStr(s), ..) => s
          KLit(LNum(n), ..) => @value.number_text(n)
          KLit(_, raw~, ..) => raw
          KComputed(_) => ""
        }
        props[k] = self.constant(value, frame, "\{path}.\{k}", entries)
      }
      SpreadMember(_, ..) => ()
    }
  }
  Obj({ props, frozen: true, })
}

///|
/// Makes a module: Ok(instance), or how making a constant ended and the steps
/// it took. resolve gives another module's source by specifier; the modules
/// it imports are made by the same interpreter, so their helpers count steps
/// as its own do.
pub fn instantiate(
  m : @ast.Module,
  host : @host.Host,
  runtime : Runtime,
  resolve? : (String) -> String?,
  max_steps~ : Int32 = 1_000_000,
  max_depth~ : Int32 = 1000,
) -> Result[Instance, (Outcome, Int32)] {
  let interp : Interp = {
    host,
    runtime,
    max_steps,
    max_depth,
    steps: 0,
    depth: 0,
  }
  try make_module(m, interp, resolve, Map([])) catch {
    Thrown(kind~, message~) => Err((Terminated(kind~, message~), interp.steps))
    UndefinedBehaviour(why) | Limit(why) =>
      Err((Outcome::Undefined(why), interp.steps))
  } noraise {
    inst => Ok(inst)
  }
}

///|
fn make_module(
  m : @ast.Module,
  interp : Interp,
  resolve : ((String) -> String?)?,
  cache : Map[String, Instance],
) -> Instance raise RunError {
  let frame : Frame = { parent: None, vars: Map([]), this_: Undefined, }
  let entries : Map[String, EntryFn] = Map([])
  let namespaces : Map[String, Value] = Map([])
  let consts : Map[String, Value] = Map([])
  let exports : Map[String, Value] = Map([])
  for item in m.items {
    if item.declaration() is FunctionDecl(f) && f.id is Some(id) {
      frame.vars[id.name] = interp.helper(f, frame)
    }
  }
  for item in m.items {
    guard item.declaration() is Import(type_only=false, specs~, source~, ..) else {
      continue
    }
    let from : Map[String, Value] = match interp.host.import_module(source) {
      Some(hm) => {
        let mv = interp.host_value(hm)
        let out = Map([])
        for sp in specs {
          out[sp.imported.name] = read(mv, sp.imported.name)
        }
        out
      }
      None => {
        if !cache.contains(source) {
          let text = match resolve {
            Some(r) => r(source)
            None => None
          }
          guard text is Some(t) && @parser.parse_module(t) is Ok(sub) else {
            raise UndefinedBehaviour("there is no module \{source}")
          }
          cache[source] = make_module(sub, interp, resolve, cache)
        }
        cache[source].exports
      }
    }
    for sp in specs {
      frame.vars[sp.local_.name] = from
        .get(sp.imported.name)
        .unwrap_or(Undefined)
    }
  }
  for item in m.items {
    let exported = item is Export(_, ..)
    match item.declaration() {
      Const(VarDecl(decls~, ..)) =>
        for d in decls {
          guard d.id is PIdent(id) && d.init is Some(init) else { continue }
          let v = interp.constant(init, frame, id.name, entries)
          frame.vars[id.name] = v
          if is_namespace(init) {
            namespaces[id.name] = v
          } else {
            consts[id.name] = v
          }
          if exported {
            exports[id.name] = v
          }
        }
      FunctionDecl({ id: Some(id), .. }) if exported =>
        exports[id.name] = frame.vars.get(id.name).unwrap_or(Undefined)
      _ => ()
    }
  }
  { interp, entries, namespaces, consts, exports, }
}

///|
/// Runs the entry at path of a made module, with this and its arguments: how
/// the run ended and the steps it took.
pub fn run_entry(
  inst : Instance,
  path : String,
  this_~ : Value = Undefined,
  args~ : Array[Value] = [],
) -> (Outcome, Int32) {
  let interp = inst.interp
  interp.steps = 0
  interp.depth = 0
  guard inst.entries.get(path) is Some(entry) else {
    return (
      Terminated(kind="TypeError", message="there is no entry \{path}"),
      0,
    )
  }
  let outcome = try
    interp.call_function(
      entry.func,
      this_,
      if entry.getter {
        []
      } else {
        args
      },
      Some(entry.frame),
    )
  catch {
    Thrown(kind~, message~) => Terminated(kind~, message~)
    UndefinedBehaviour(why) | Limit(why) => Outcome::Undefined(why)
  } noraise {
    v => Finished(v)
  }
  (outcome, interp.steps)
}
