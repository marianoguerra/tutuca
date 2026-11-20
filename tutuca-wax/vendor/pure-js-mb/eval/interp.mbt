// The interpreter, as the reference's lib/interp.js: runs a checked program by
// walking its tree. It counts steps and callback depth, both deterministic, and
// ends a run past them as undefined. Built-in methods are JavaScript's
// (builtins.mbt), given callbacks that run in the interpreter; host functions
// are answered by the Runtime, by qualified name.

///|
/// What answers calls to host functions: the qualified name ("Math.max",
/// "Ctx.notify", "String"), this (the handle, for a handle's method, else
/// undefined), and the arguments.
pub(all) struct Runtime {
  call : (String, Value, Array[Value]) -> Value raise RunError
}

///|
/// How a run ended.
pub(all) enum Outcome {
  Finished(Value)
  Terminated(kind~ : String, message~ : String)
  Undefined(String)
}

///|
priv struct Frame {
  parent : Frame?
  vars : Map[String, Value]
  this_ : Value
}

///|
fn Frame::lookup(self : Frame, name : String) -> Value? {
  match self.vars.get(name) {
    Some(v) => Some(v)
    None =>
      match self.parent {
        Some(p) => p.lookup(name)
        None => None
      }
  }
}

///|
/// The frame a name is bound in.
fn Frame::owner(self : Frame, name : String) -> Frame? {
  if self.vars.contains(name) {
    return Some(self)
  }
  match self.parent {
    Some(p) => p.owner(name)
    None => None
  }
}

///|
priv enum Completion {
  Normal
  Returned(Value)
  Broke
  Continued
}

///|
priv enum Link {
  Val(Value)
  Short
}

///|
priv struct Interp {
  host : @host.Host
  runtime : Runtime
  max_steps : Int32
  max_depth : Int32
  mut steps : Int32
  mut depth : Int32
}

///|
fn Interp::step(self : Interp) -> Unit raise RunError {
  self.steps += 1
  if self.steps > self.max_steps {
    raise Limit("more than \{self.max_steps} steps")
  }
}

///|
fn Interp::bind(
  self : Interp,
  frame : Frame,
  p : @ast.Pattern,
  v : Value,
) -> Unit raise RunError {
  match p {
    PIdent(id) => frame.vars[id.name] = v
    PArray(elements~, ..) => {
      // What destructuring an array does: iterate it.
      let items = match v {
        List(l) => l.items.copy()
        Str(s) => s.iter().map(c => Value::Str(c.to_string())).collect()
        _ =>
          raise @value.type_error("\{@value.to_js_string(v)} is not iterable")
      }
      for i, e in elements {
        match e {
          Some(PRest(arg~, ..)) =>
            self.bind(frame, arg, @value.list(items[i:].to_owned()))
          Some(x) => self.bind(frame, x, items.get(i).unwrap_or(Undefined))
          None => ()
        }
      }
    }
    PObject(props~, ..) => {
      if v is (Null | Undefined) {
        let t = @value.to_js_string(v)
        raise @value.type_error("Cannot destructure '\{t}' as it is \{t}.")
      }
      let taken = []
      for prop in props {
        match prop {
          PPRest(arg~, ..) => {
            let rest : Map[String, Value] = Map([])
            match v {
              Obj(o) =>
                for k, x in o.props {
                  if !taken.contains(k) {
                    rest[k] = x
                  }
                }
              _ => ()
            }
            frame.vars[arg.name] = @value.obj(rest)
          }
          PPProp(key~, value~, ..) => {
            let k = match key {
              KIdent(id) => id.name
              KLit(LStr(s), ..) => s
              KLit(LNum(n), ..) => @value.number_text(n)
              KLit(_, raw~, ..) => raw
              KComputed(_) => ""
            }
            taken.push(k)
            self.bind(frame, value, read(v, k))
          }
        }
      }
    }
    PAssign(left~, right~, ..) =>
      self.bind(
        frame,
        left,
        if v is Undefined {
          self.expr(right, frame)
        } else {
          v
        },
      )
    _ => raise UndefinedBehaviour("binding a pattern pure-js doesn't run")
  }
}

///|
fn Interp::call_function(
  self : Interp,
  f : @ast.Func,
  this_ : Value,
  args : Array[Value],
  parent : Frame?,
) -> Value raise RunError {
  let frame : Frame = { parent, vars: Map([]), this_, }
  for i, p in f.params {
    self.bind(frame, p, args.get(i).unwrap_or(Undefined))
  }
  match f.body {
    ExprBody(e) => self.expr(e, frame)
    BlockBody(b) =>
      match self.statements(b.body, frame) {
        Returned(v) => v
        _ => Undefined
      }
  }
}

///|
/// A callback as a value, for the built-in methods to call.
fn Interp::callback(self : Interp, f : @ast.Func, frame : Frame) -> Value {
  Fn({
    call: args => {
      self.depth += 1
      if self.depth > self.max_depth {
        raise Limit("callbacks nested more than \{self.max_depth} deep")
      }
      errdefer {
        self.depth -= 1
      }
      let result = self.call_function(f, frame.this_, args, Some(frame))
      self.depth -= 1
      result
    },
  })
}

///|
fn Interp::statements(
  self : Interp,
  list : Array[@ast.Stmt],
  frame : Frame,
) -> Completion raise RunError {
  for s in list {
    match self.statement(s, frame) {
      Normal => ()
      // A return, a break or a continue.
      other => return other
    }
  }
  Normal
}

///|
fn Interp::statement(
  self : Interp,
  s : @ast.Stmt,
  frame : Frame,
) -> Completion raise RunError {
  self.step()
  match s {
    VarDecl(decls~, ..) => {
      for d in decls {
        let v = match d.init {
          Some(e) => self.expr(e, frame)
          None => Undefined
        }
        self.bind(frame, d.id, v)
      }
      Normal
    }
    ExprStmt(e, ..) => {
      ignore(self.expr(e, frame))
      Normal
    }
    If(cond~, cons~, alt~, ..) =>
      if @value.truthy(self.expr(cond, frame)) {
        self.statement(cons, frame)
      } else {
        match alt {
          Some(a) => self.statement(a, frame)
          None => Normal
        }
      }
    BlockStmt(b) =>
      self.statements(b.body, {
        parent: Some(frame),
        vars: Map([]),
        this_: frame.this_,
      })
    Return(arg, ..) =>
      Returned(
        match arg {
          Some(e) => self.expr(e, frame)
          None => Undefined
        },
      )
    ForOf(left=VarDecl(decls~, ..), right~, body~, ..) => {
      // The loop walks what the list (or string) held when it began.
      let items = self.iterate(self.expr(right, frame))
      for item in items {
        self.step()
        let inner : Frame = {
          parent: Some(frame),
          vars: Map([]),
          this_: frame.this_,
        }
        self.bind(inner, decls[0].id, item)
        match self.statement(body, inner) {
          Broke => break
          Returned(v) => return Returned(v)
          _ => ()
        }
      }
      Normal
    }
    Break(_) => Broke
    Continue(_) => Continued
    _ => raise UndefinedBehaviour("running a statement pure-js doesn't run")
  }
}

///|
fn Interp::expr(
  self : Interp,
  e : @ast.Expr,
  frame : Frame,
) -> Value raise RunError {
  self.step()
  match e {
    Ident(id) =>
      match frame.lookup(id.name) {
        Some(v) => v
        None =>
          if id.name == "undefined" {
            Undefined
          } else {
            self.host_value(id.name)
          }
      }
    This(_) => frame.this_
    Lit(LNull, ..) => Null
    Lit(LBool(b), ..) => Bool(b)
    Lit(LNum(n), ..) => Num(n)
    Lit(LStr(s), ..) => Str(s)
    Template(quasis~, exprs~, ..) => {
      let sb = StringBuilder()
      for i, q in quasis {
        sb.write_string(q.cooked)
        if i < exprs.length() {
          sb.write_string(@value.to_js_string(self.expr(exprs[i], frame)))
        }
      }
      Str(sb.to_string())
    }
    ArrayLit(elements, ..) => {
      let out = []
      for x in elements {
        match x {
          Some(Spread(arg, ..)) =>
            out.push_iter(self.iterate(self.expr(arg, frame)).iter())
          Some(x) => out.push(self.expr(x, frame))
          None => out.push(Undefined)
        }
      }
      @value.list(out)
    }
    ObjectLit(members, ..) => {
      let props : Map[String, Value] = Map([])
      for m in members {
        match m {
          SpreadMember(arg, ..) =>
            match self.expr(arg, frame) {
              Obj(o) =>
                for k, v in o.props {
                  props[k] = v
                }
              Handle(h) =>
                for k, v in h.fields {
                  props[k] = v
                }
              List(l) =>
                for i, v in l.items {
                  props[i.to_string()] = v
                }
              Str(s) =>
                for i, c in s.iter().collect() {
                  props[i.to_string()] = Str(c.to_string())
                }
              _ => ()
            }
          Prop(key~, value~, ..) => {
            let k = match key {
              KIdent(id) => id.name
              KLit(LStr(s), ..) => s
              KLit(LNum(n), ..) => @value.number_text(n)
              KLit(_, raw~, ..) => raw
              KComputed(x) => @value.to_js_string(self.expr(x, frame))
            }
            props[k] = self.expr(value, frame)
          }
          // A namespace's entries are made by instantiate.
          Method(..) => ()
        }
      }
      @value.obj(props)
    }
    Member(..) | Call(..) =>
      match self.link(e, frame) {
        Val(v) => v
        Short => Undefined
      }
    Chain(inner, ..) =>
      match self.link(inner, frame) {
        Val(v) => v
        Short => Undefined
      }
    Unary(op~, arg~, ..) => {
      let v = self.expr(arg, frame)
      match op {
        "!" => Bool(!@value.truthy(v))
        "-" => Num(-@value.to_number(v))
        "typeof" => Str(@value.type_of(v))
        _ => raise UndefinedBehaviour("the operator \{op}")
      }
    }
    Binary(op~, left~, right~, ..) => {
      let a = self.expr(left, frame)
      let b = self.expr(right, frame)
      binary(op, a, b)
    }
    Logical(op~, left~, right~, ..) => {
      let a = self.expr(left, frame)
      match op {
        "&&" => if @value.truthy(a) { self.expr(right, frame) } else { a }
        "||" => if @value.truthy(a) { a } else { self.expr(right, frame) }
        _ => if a is (Null | Undefined) { self.expr(right, frame) } else { a }
      }
    }
    Cond(cond~, cons~, alt~, ..) =>
      if @value.truthy(self.expr(cond, frame)) {
        self.expr(cons, frame)
      } else {
        self.expr(alt, frame)
      }
    Assign(..) => {
      self.assign(e, frame)
      Undefined
    }
    Arrow(f) => self.callback(f, frame)
    Spread(_, ..) | Update(..) =>
      raise UndefinedBehaviour("running an expression pure-js doesn't run")
  }
}

///|
fn binary(op : String, a : Value, b : Value) -> Value raise RunError {
  match op {
    "+" =>
      match (a, b) {
        (Str(x), _) => Str(x + @value.to_js_string(b))
        (_, Str(y)) => Str(@value.to_js_string(a) + y)
        _ => Num(@value.to_number(a) + @value.to_number(b))
      }
    "-" => Num(@value.to_number(a) - @value.to_number(b))
    "*" => Num(@value.to_number(a) * @value.to_number(b))
    "/" => Num(@value.to_number(a) / @value.to_number(b))
    "%" => Num(js_remainder(@value.to_number(a), @value.to_number(b)))
    "<" | ">" | "<=" | ">=" =>
      match (a, b) {
        (Str(x), Str(y)) => {
          let c = x.compare(y)
          Bool(
            match op {
              "<" => c < 0
              ">" => c > 0
              "<=" => c <= 0
              _ => c >= 0
            },
          )
        }
        _ => {
          let x = @value.to_number(a)
          let y = @value.to_number(b)
          Bool(
            match op {
              "<" => x < y
              ">" => x > y
              "<=" => x <= y
              _ => x >= y
            },
          )
        }
      }
    "===" => Bool(@value.strict_equal(a, b))
    "!==" => Bool(!@value.strict_equal(a, b))
    _ => raise UndefinedBehaviour("the operator \{op}")
  }
}

///|
/// JavaScript's %: the sign of the dividend.
fn js_remainder(x : Double, y : Double) -> Double {
  if x != x ||
    y != y ||
    y == 0.0 ||
    x == @double.infinity ||
    x == @double.neg_infinity {
    return @double.not_a_number
  }
  if y == @double.infinity || y == @double.neg_infinity {
    return x
  }
  let r = x - (x / y).trunc() * y
  if r == 0.0 && x < 0.0 {
    -0.0
  } else {
    r
  }
}

///|
fn Interp::iterate(self : Interp, v : Value) -> Array[Value] raise RunError {
  ignore(self)
  match v {
    List(l) => l.items.copy()
    Str(s) => s.iter().map(c => Value::Str(c.to_string())).collect()
    _ => raise @value.type_error("\{@value.to_js_string(v)} is not iterable")
  }
}

///|
fn Interp::host_value(self : Interp, name : String) -> Value raise RunError {
  match self.host.binding(name) {
    Some(ModuleBinding(_, ..)) => Module(name)
    Some(FunctionBinding(_, _)) => HostFn(name)
    None =>
      raise UndefinedBehaviour(
        "\{name} is neither the program's nor the host's",
      )
  }
}

///|
/// The object of a member or the receiver of a method: a link when it is one.
fn Interp::object(
  self : Interp,
  e : @ast.Expr,
  frame : Frame,
) -> Link raise RunError {
  match e {
    Member(..) | Call(..) => self.link(e, frame)
    _ => Val(self.expr(e, frame))
  }
}

///|
fn Interp::link(
  self : Interp,
  e : @ast.Expr,
  frame : Frame,
) -> Link raise RunError {
  match e {
    Call(..) => self.call(e, frame)
    Member(object~, property~, computed~, optional~, ..) => {
      guard self.object(object, frame) is Val(obj) else { return Short }
      if optional && obj is (Null | Undefined) {
        return Short
      }
      if computed {
        return Val(index_get(obj, self.expr(property, frame)))
      }
      guard property is Ident(p) else { return Val(Undefined) }
      Val(read(obj, p.name))
    }
    _ => Val(self.expr(e, frame))
  }
}

///|
fn read(obj : Value, name : String) -> Value raise RunError {
  if @tables.is_reserved(name) {
    raise UndefinedBehaviour("reading the reserved property \{name}")
  }
  match obj {
    Undefined | Null =>
      raise @value.type_error(
        "Cannot read properties of \{@value.to_js_string(obj)} (reading '\{name}')",
      )
    Obj(o) => o.props.get(name).unwrap_or(Undefined)
    Handle(h) => h.fields.get(name).unwrap_or(HostFn("\{h.name}.\{name}"))
    List(l) =>
      if name == "length" {
        Num(l.items.length().to_double())
      } else {
        Undefined
      }
    Str(s) =>
      if name == "length" {
        Num(s.length().to_double())
      } else {
        Undefined
      }
    Module(m) => HostFn("\{m}.\{name}")
    _ => Undefined
  }
}

///|
fn Interp::args(
  self : Interp,
  list : Array[@ast.Expr],
  frame : Frame,
) -> Array[Value] raise RunError {
  let out = []
  for a in list {
    match a {
      Spread(arg, ..) =>
        out.push_iter(self.iterate(self.expr(arg, frame)).iter())
      Arrow(f) => out.push(self.callback(f, frame))
      _ => out.push(self.expr(a, frame))
    }
  }
  out
}

///|
fn Interp::call(
  self : Interp,
  e : @ast.Expr,
  frame : Frame,
) -> Link raise RunError {
  guard e is Call(callee~, args~, ..) else { return Val(Undefined) }
  match callee {
    Member(object~, property=Ident(p), computed=false, optional~, ..) => {
      guard self.object(object, frame) is Val(recv) else { return Short }
      if optional && recv is (Null | Undefined) {
        return Short
      }
      if @tables.is_reserved(p.name) {
        raise UndefinedBehaviour("reading the reserved property \{p.name}")
      }
      if recv is (Undefined | Null) {
        raise @value.type_error(
          "Cannot read properties of \{@value.to_js_string(recv)} (reading '\{p.name}')",
        )
      }
      let values = self.args(args, frame)
      Val(self.call_method(recv, p.name, values))
    }
    _ => {
      let f = self.expr(callee, frame)
      let values = self.args(args, frame)
      match f {
        HostFn(q) | Module(q) => Val((self.runtime.call)(q, Undefined, values))
        Fn(cb) => Val((cb.call)(values))
        _ =>
          raise @value.type_error("\{@value.to_js_string(f)} is not a function")
      }
    }
  }
}

///|
fn Interp::call_method(
  self : Interp,
  recv : Value,
  name : String,
  args : Array[Value],
) -> Value raise RunError {
  match recv {
    Module(m) => (self.runtime.call)("\{m}.\{name}", Undefined, args)
    Handle(h) => (self.runtime.call)("\{h.name}.\{name}", recv, args)
    List(l) => list_method(l, name, args)
    Str(s) => string_method(s, name, args)
    Num(n) => number_method(n, name, args)
    Obj(o) =>
      match o.props.get(name) {
        Some(Fn(cb)) => (cb.call)(args)
        Some(HostFn(q)) => (self.runtime.call)(q, recv, args)
        _ => raise @value.type_error("\{name} is not a function")
      }
    _ => raise @value.type_error("\{name} is not a function")
  }
}

///|
fn Interp::assign(
  self : Interp,
  e : @ast.Expr,
  frame : Frame,
) -> Unit raise RunError {
  guard e is Assign(op~, left~, right~, ..) else { return }
  if left is Ident(id) {
    guard frame.owner(id.name) is Some(f) else {
      raise UndefinedBehaviour("assigning to \{id.name}")
    }
    let v = self.expr(right, frame)
    let old = f.vars.get(id.name).unwrap_or(Undefined)
    f.vars[id.name] = match op {
      "=" => v
      "+=" => binary("+", old, v)
      _ => binary("-", old, v)
    }
    return
  }
  guard left is Member(object~, property~, computed~, ..) else {
    raise UndefinedBehaviour("assigning to a name")
  }
  let obj = match self.object(object, frame) {
    Val(v) => v
    Short => Undefined
  }
  if computed {
    let key = self.expr(property, frame)
    index_set(obj, key, self.expr(right, frame))
    return
  }
  guard property is Ident(p) else { return }
  let name = p.name
  if @tables.is_reserved(name) {
    raise UndefinedBehaviour("setting the reserved property \{name}")
  }
  match obj {
    Undefined | Null =>
      raise @value.type_error(
        "Cannot set properties of \{@value.to_js_string(obj)} (setting '\{name}')",
      )
    Obj(o) => {
      let v = if op == "=" {
        self.expr(right, frame)
      } else {
        binary(
          if op == "+=" {
            "+"
          } else {
            "-"
          },
          o.props.get(name).unwrap_or(Undefined),
          self.expr(right, frame),
        )
      }
      if o.frozen {
        raise @value.type_error(
          "Cannot assign to read only property '\{name}' of object",
        )
      }
      o.props[name] = v
    }
    _ => {
      ignore(self.expr(right, frame))
      raise @value.type_error(
        "Cannot create property '\{name}' on \{@value.type_of(obj)}",
      )
    }
  }
}

///|
/// Runs a checked program (verify it first) with this and its arguments.
pub fn run(
  program : @ast.Program,
  host : @host.Host,
  runtime : Runtime,
  this_~ : Value = Undefined,
  args~ : Array[Value] = [],
  max_steps~ : Int32 = 1_000_000,
  max_depth~ : Int32 = 1000,
) -> (Outcome, Int32) {
  let interp : Interp = {
    host,
    runtime,
    max_steps,
    max_depth,
    steps: 0,
    depth: 0,
  }
  let outcome = try
    interp.call_function(program.func, this_, args, None)
  catch {
    Thrown(kind~, message~) => Terminated(kind~, message~)
    UndefinedBehaviour(why) | Limit(why) => Outcome::Undefined(why)
  } noraise {
    v => Finished(v)
  }
  (outcome, interp.steps)
}
