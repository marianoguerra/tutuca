///|
/// What a query runs on and outputs: a Value, a Message, or a message's list of child
/// messages (`.messages`).
pub(all) enum Subject {
  V(@model.Value)
  M(@model.Message)
  L(Array[@model.Message])
}

///|
/// The bindings in scope: a persistent list, newest first, so backtracking costs nothing.
pub(all) enum Env {
  Nil
  Cons(String, Subject, Env)
}

///|
pub fn Env::lookup(self : Env, name : String) -> Subject? {
  let mut env = self
  while env is Cons(k, v, rest) {
    if k == name {
      return Some(v)
    }
    env = rest
  }
  None
}

///|
/// The bindings in the order they were first bound.
pub fn Env::to_array(self : Env) -> Array[(String, Subject)] {
  let out = []
  let mut env = self
  while env is Cons(k, v, rest) {
    out.push((k, v))
    env = rest
  }
  out.rev_in_place()
  out
}

///|
/// One output of a query and the bindings it was produced with.
pub(all) struct Solution {
  value : Subject
  bindings : Array[(String, Subject)]
}

///|
/// The type_id a message takes when it has to be a Value: in a collected array, and in the
/// results the FFI encodes.
pub let message_type_id : String = "tdata/message"

///|
/// A message as a Value: `#"tdata/message" {id, kind, data | messages, meta?}` with the child
/// messages and meta written the same way the JSON envelope writes them.
pub fn message_value(m : @model.Message) -> @model.Value {
  let o = @model.OMap::new()
  o.push("id", String(m.id))
  o.push("kind", String(m.kind))
  match m.payload {
    Data(v) => o.push("data", v)
    Messages(l) => o.push("messages", Array(l.map(message_value)))
  }
  if m.meta.length() > 0 {
    o.push("meta", Object(m.meta))
  }
  Typed(message_type_id, Object(o))
}

///|
pub fn Subject::to_value(self : Subject) -> @model.Value {
  match self {
    V(v) => v
    M(m) => message_value(m)
    L(l) => Array(l.map(message_value))
  }
}

///|
fn truthy(x : Subject) -> Bool {
  !(x is V(Null | Bool(false)))
}

///|
fn same(a : Subject, b : Subject) -> Bool {
  match (a, b) {
    (V(x), V(y)) => @model.equal(x, y)
    (M(x), M(y)) => @model.equal_messages(x, y)
    (L(x), L(y)) => @model.equal_message_lists(x, y)
    _ => @model.equal(a.to_value(), b.to_value())
  }
}

///|
/// `x.name`: an Object key, or a field of a Message, a Node or a Typed.
fn field(x : Subject, name : String) -> Subject? {
  match x {
    V(Object(m)) =>
      match m.get(name) {
        Some(v) => Some(V(v))
        None => None
      }
    V(Node(tag, attrs, children)) =>
      match name {
        "tag" => Some(V(String(tag)))
        "attrs" => Some(V(Object(attrs)))
        "children" => Some(V(Array(children)))
        _ => None
      }
    V(Typed(_, v)) => if name == "value" { Some(V(v)) } else { None }
    M(m) =>
      match (name, m.payload) {
        ("id", _) => Some(V(String(m.id)))
        ("kind", _) => Some(V(String(m.kind)))
        ("data", Data(v)) => Some(V(v))
        ("messages", Messages(l)) => Some(L(l))
        ("meta", _) => Some(V(Object(m.meta)))
        _ => None
      }
    _ => None
  }
}

///|
fn index(x : Subject, n : Int64) -> Subject? {
  let len = match x {
    V(Array(a)) => a.length()
    L(l) => l.length()
    _ => return None
  }
  let i = if n < 0L { n + len.to_int64() } else { n }
  if i < 0L || i >= len.to_int64() {
    return None
  }
  match x {
    V(Array(a)) => Some(V(a[i.to_int()]))
    L(l) => Some(M(l[i.to_int()]))
    _ => None
  }
}

///|
/// `x[]`: the elements of an Array, a Set or a message list, the values of an Object.
fn each(x : Subject) -> Array[Subject] {
  match x {
    V(Array(a)) | V(Set(a)) => a.map(e => V(e))
    V(Object(m)) => m.vals.map(e => V(e))
    L(l) => l.map(e => M(e))
    _ => []
  }
}

///|
/// The parts `..` descends into: a Message's id, kind, data or messages, and meta; a Node's tag,
/// attrs and children; a Typed's value; for everything else what `[]` gives.
fn parts(x : Subject) -> Array[Subject] {
  match x {
    M(m) =>
      [
        V(String(m.id)),
        V(String(m.kind)),
        match m.payload {
          Data(v) => V(v)
          Messages(l) => L(l)
        },
        V(Object(m.meta)),
      ]
    V(Node(tag, attrs, children)) =>
      [V(String(tag)), V(Object(attrs)), V(Array(children))]
    V(Typed(_, v)) => [V(v)]
    _ => each(x)
  }
}

///|
/// A continuation: gets each output; returns false to stop the evaluation.
type K = (Subject, Env) -> Bool

///|
/// Runs `e` on `x`, passing every output to `k` in order. Returns false when `k` stopped it.
pub fn eval(e : Expr, x : Subject, env : Env, k : K) -> Bool {
  match e {
    Identity => k(x, env)
    Recurse => recurse(x, env, k)
    Field(e1, name) =>
      eval(e1, x, env, (y, env1) => {
        match field(y, name) {
          Some(z) => k(z, env1)
          None => true
        }
      })
    Index(e1, n) =>
      eval(e1, x, env, (y, env1) => {
        match index(y, n) {
          Some(z) => k(z, env1)
          None => true
        }
      })
    Each(e1) =>
      eval(e1, x, env, (y, env1) => {
        for z in each(y) {
          if !k(z, env1) {
            return false
          }
        }
        true
      })
    Literal(v) => k(V(v), env)
    Var(name) =>
      match env.lookup(name) {
        Some(v) => k(v, env)
        None => true
      }
    Pipe(a, b) => eval(a, x, env, (y, env1) => eval(b, y, env1, k))
    Comma(a, b) => eval(a, x, env, k) && eval(b, x, env, k)
    Alt(a, b) => {
      let mut any = false
      let go = eval(a, x, env, (y, env1) => {
        if !truthy(y) {
          return true
        }
        any = true
        k(y, env1)
      })
      if !go {
        return false
      }
      any || eval(b, x, env, k)
    }
    And(a, b) =>
      match first_truthy(a, x, env) {
        None => k(V(Bool(false)), env)
        Some(env1) =>
          match first_truthy(b, x, env1) {
            Some(env2) => k(V(Bool(true)), env2)
            None => k(V(Bool(false)), env)
          }
      }
    Or(a, b) =>
      match first_truthy(a, x, env) {
        Some(env1) => k(V(Bool(true)), env1)
        None =>
          match first_truthy(b, x, env) {
            Some(env2) => k(V(Bool(true)), env2)
            None => k(V(Bool(false)), env)
          }
      }
    Compare(op, a, b) =>
      eval(a, x, env, (va, env1) => {
        eval(b, x, env1, (vb, env2) => k(V(Bool(compare(op, va, vb))), env2))
      })
    Match(e1, p) =>
      eval(e1, x, env, (y, env1) => {
        match_pattern(p, y, env1, env2 => k(y, env2))
      })
    As(e1, p, body) =>
      eval(e1, x, env, (y, env1) => {
        match_pattern(p, y, env1, env2 => eval(body, x, env2, k))
      })
    Collect(e1) => {
      let items = []
      let _ = eval(e1, x, env, (y, _) => {
        items.push(y.to_value())
        true
      })
      k(V(Array(items)), env)
    }
    Call(b, arg) => call(b, arg, x, env, k)
  }
}

///|
fn recurse(x : Subject, env : Env, k : K) -> Bool {
  if !k(x, env) {
    return false
  }
  for p in parts(x) {
    if !recurse(p, env, k) {
      return false
    }
  }
  true
}

///|
/// The bindings of the first truthy output of `e`, if there is one.
fn first_truthy(e : Expr, x : Subject, env : Env) -> Env? {
  let mut found : Env? = None
  let _ = eval(e, x, env, (y, env1) => {
    if !truthy(y) {
      return true
    }
    found = Some(env1)
    false
  })
  found
}

///|
fn compare(op : CmpOp, a : Subject, b : Subject) -> Bool {
  match op {
    Eq => same(a, b)
    Ne => !same(a, b)
    _ => {
      guard (a, b) is (V(x), V(y)) else { return false }
      match @model.compare(x, y) {
        None => false
        Some(c) =>
          match op {
            Lt => c < 0
            Le => c <= 0
            Gt => c > 0
            _ => c >= 0
          }
      }
    }
  }
}

///|
fn call(b : Builtin, arg : Expr?, x : Subject, env : Env, k : K) -> Bool {
  let arg = arg.unwrap_or(Identity)
  match b {
    Select =>
      match first_truthy(arg, x, env) {
        Some(env1) => k(x, env1)
        None => true
      }
    Not => k(V(Bool(!truthy(x))), env)
    Empty => true
    Type =>
      k(
        V(
          String(
            match x {
              V(v) => v.kind_name()
              M(_) => "message"
              L(_) => "messages"
            },
          ),
        ),
        env,
      )
    TypeId =>
      match x {
        V(Typed(id, _)) => k(V(String(id)), env)
        _ => true
      }
    Length =>
      match length(x) {
        Some(n) => k(V(Int(n.to_int64())), env)
        None => true
      }
    Keys =>
      match keys(x) {
        Some(ks) => k(V(Array(ks.map(e => String(e)))), env)
        None => true
      }
    Has =>
      eval(arg, x, env, (key, env1) => {
        match key {
          V(String(name)) =>
            match x {
              V(Object(_)) | M(_) => k(V(Bool(field(x, name) is Some(_))), env1)
              _ => true
            }
          V(Int(n)) =>
            match x {
              V(Array(_)) | L(_) => k(V(Bool(index(x, n) is Some(_))), env1)
              _ => true
            }
          _ => true
        }
      })
    StartsWith | EndsWith | Contains => {
      guard x is V(String(s)) else { return true }
      eval(arg, x, env, (t, env1) => {
        match t {
          V(String(t)) => {
            let r = match b {
              StartsWith => s.has_prefix(t)
              EndsWith => s.has_suffix(t)
              _ => s.contains(t)
            }
            k(V(Bool(r)), env1)
          }
          _ => true
        }
      })
    }
    First => {
      let mut found : (Subject, Env)? = None
      let _ = eval(arg, x, env, (y, env1) => {
        found = Some((y, env1))
        false
      })
      match found {
        Some((y, env1)) => k(y, env1)
        None => true
      }
    }
    Any => k(V(Bool(first_truthy(arg, x, env) is Some(_))), env)
    All => {
      let mut all = true
      let _ = eval(arg, x, env, (y, _) => {
        if truthy(y) {
          return true
        }
        all = false
        false
      })
      k(V(Bool(all)), env)
    }
  }
}

///|
fn length(x : Subject) -> Int32? {
  match x {
    V(String(s)) => Some(s.char_length())
    V(Bytes(b)) => Some(b.length())
    V(Array(a)) | V(Set(a)) => Some(a.length())
    V(Object(m)) => Some(m.length())
    L(l) => Some(l.length())
    _ => None
  }
}

///|
fn keys(x : Subject) -> Array[String]? {
  match x {
    V(Object(m)) => Some(m.keys.copy())
    M(m) =>
      Some([
        "id",
        "kind",
        match m.payload {
          Data(_) => "data"
          Messages(_) => "messages"
        },
        "meta",
      ])
    _ => None
  }
}

///|
/// Matches `p` against `x`, calling `k` with the bindings of each way it matches (more than one
/// only through alternatives). Returns false when `k` stopped it.
pub fn match_pattern(
  p : Pattern,
  x : Subject,
  env : Env,
  k : (Env) -> Bool,
) -> Bool {
  match p {
    Wild => k(env)
    Bind(name) => bind(name, x, env, k)
    Lit(v) => if same(V(v), x) { k(env) } else { true }
    At(name, p1) => bind(name, x, env, env1 => match_pattern(p1, x, env1, k))
    Alts(ps) => {
      for p1 in ps {
        if !match_pattern(p1, x, env, k) {
          return false
        }
      }
      true
    }
    Obj(fields) => {
      guard x is (V(Object(_)) | M(_)) else { return true }
      match_fields(fields, 0, x, env, k)
    }
    Arr(items, rest) => {
      let elems : Array[Subject] = match x {
        V(Array(a)) => a.map(e => V(e))
        L(l) => l.map(e => M(e))
        _ => return true
      }
      let n = items.length()
      match rest {
        Exact => if elems.length() != n { return true }
        _ => if elems.length() < n { return true }
      }
      let after = (env1 : Env) => {
        match rest {
          RestBind(name) => {
            let tail : Subject = match x {
              L(l) => L(l[n:].to_owned())
              V(Array(a)) => V(Array(a[n:].to_owned()))
              _ => panic()
            }
            bind(name, tail, env1, k)
          }
          _ => k(env1)
        }
      }
      match_items(items, 0, elems, env, after)
    }
    Typed(id, p1) =>
      match x {
        V(Typed(id2, v)) if id == id2 => match_pattern(p1, V(v), env, k)
        _ => true
      }
    Node(pt, pa, pc) =>
      match x {
        V(Node(tag, attrs, children)) =>
          match_pattern(pt, V(String(tag)), env, env1 => {
            match_pattern(pa, V(Object(attrs)), env1, env2 => {
              match_pattern(pc, V(Array(children)), env2, k)
            })
          })
        _ => true
      }
  }
}

///|
/// Binds `name`, or, if it's bound already, checks the value is the same.
fn bind(name : String, x : Subject, env : Env, k : (Env) -> Bool) -> Bool {
  match env.lookup(name) {
    Some(v) => if same(v, x) { k(env) } else { true }
    None => k(Cons(name, x, env))
  }
}

///|
fn match_fields(
  fields : Array[(String, Pattern)],
  i : Int32,
  x : Subject,
  env : Env,
  k : (Env) -> Bool,
) -> Bool {
  if i == fields.length() {
    return k(env)
  }
  let (name, p) = fields[i]
  match field(x, name) {
    Some(y) =>
      match_pattern(p, y, env, env1 => match_fields(fields, i + 1, x, env1, k))
    None => true
  }
}

///|
fn match_items(
  items : Array[Pattern],
  i : Int32,
  elems : Array[Subject],
  env : Env,
  k : (Env) -> Bool,
) -> Bool {
  if i == items.length() {
    return k(env)
  }
  match_pattern(items[i], elems[i], env, env1 => {
    match_items(items, i + 1, elems, env1, k)
  })
}

///|
/// Every output of the query, in order.
pub fn run(q : Expr, x : Subject) -> Array[Solution] {
  let out = []
  let _ = eval(q, x, Nil, (y, env) => {
    out.push({ value: y, bindings: env.to_array(), })
    true
  })
  out
}

///|
/// The outputs that match: the truthy ones.
pub fn match_all(q : Expr, x : Subject) -> Array[Solution] {
  let out = []
  let _ = eval(q, x, Nil, (y, env) => {
    if truthy(y) {
      out.push({ value: y, bindings: env.to_array(), })
    }
    true
  })
  out
}

///|
/// The first output that matches.
pub fn match_first(q : Expr, x : Subject) -> Solution? {
  let mut found : Solution? = None
  let _ = eval(q, x, Nil, (y, env) => {
    if !truthy(y) {
      return true
    }
    found = Some({ value: y, bindings: env.to_array(), })
    false
  })
  found
}
