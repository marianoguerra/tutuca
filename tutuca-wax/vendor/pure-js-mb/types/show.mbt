///|
/// A number as JavaScript's String(n) writes it.
pub fn number_text(n : Double) -> String {
  if n != n {
    "NaN"
  } else if n == @double.infinity {
    "Infinity"
  } else if n == @double.neg_infinity {
    "-Infinity"
  } else {
    n.to_string()
  }
}

///|
/// A string as JSON.stringify writes it.
pub fn json_string(s : String) -> String {
  Json::string(s).stringify()
}

///|
pub fn lit_text(l : @ast.Lit) -> String {
  match l {
    LStr(s) => json_string(s)
    LNum(n) => number_text(n)
    LBool(b) => b.to_string()
    LNull => "null"
  }
}

///|
fn needs_parens(t : Ty) -> Bool {
  t is (UnionT(_) | FnT(_))
}

///|
pub fn sig_to_string(s : Sig, arrow~ : Bool = true) -> String {
  let tp = if s.type_params.length() > 0 {
    "<\{s.type_params.join(", ")}>"
  } else {
    ""
  }
  let params = s.params
    .map(p => {
      "\{if p.rest { "..." } else { "" }}\{p.name}\{if p.optional { "?" } else { "" }}: \{type_to_string(p.ty)}"
    })
    .join(", ")
  "\{tp}(\{params})\{if arrow { " =>" } else { ":" }} \{type_to_string(s.result)}"
}

///|
/// A type as TypeScript writes it: what messages and inferred types show.
pub fn type_to_string(t : Ty) -> String {
  match t {
    NumberT => "number"
    StringT => "string"
    BooleanT => "boolean"
    NullT => "null"
    UndefinedT => "undefined"
    UnknownT => "unknown"
    VoidT => "void"
    NeverT => "never"
    LitT(l) => lit_text(l)
    ListT(elem~, ..) => {
      let e = type_to_string(elem)
      if needs_parens(elem) {
        "(\{e})[]"
      } else {
        "\{e}[]"
      }
    }
    TupleT(elems~, ..) => "[\{elems.map(type_to_string).join(", ")}]"
    DictT(value~, ..) => "{ [key: string]: \{type_to_string(value)} }"
    RecordT(name=Some(n), ..) => n
    RecordT(name=None, fields~, methods~, ..) => {
      let all = []
      for n, f in fields {
        all.push(
          "\{if f.read_only { "readonly " } else { "" }}\{n}\{if f.optional { "?" } else { "" }}: \{type_to_string(f.ty)}",
        )
      }
      for n, sigs in methods {
        for s in sigs {
          all.push("\{n}\{sig_to_string(s, arrow=false)}")
        }
      }
      if all.length() == 0 {
        "{}"
      } else {
        "{ \{all.join("; ")} }"
      }
    }
    UnionT(ts) => ts.map(type_to_string).join(" | ")
    RefT(name~, ..) | HandleT(name~, ..) => name
    VarT(name) => name
    FnT(sigs) => sigs.map(s => sig_to_string(s)).join(" & ")
    ModuleT(name) => "the module \{name}"
  }
}

///|
/// Type parameters replaced by what they are bound to (left as they are when
/// they aren't).
pub fn subst(t : Ty, bindings : Map[String, Ty]) -> Ty {
  match t {
    VarT(name) => bindings.get(name).unwrap_or(t)
    ListT(elem~, mutable~, deep~) =>
      ListT(elem=subst(elem, bindings), mutable~, deep~)
    TupleT(elems~, mutable~, deep~) =>
      TupleT(elems=elems.map(e => subst(e, bindings)), mutable~, deep~)
    DictT(value~, mutable~, deep~) =>
      DictT(value=subst(value, bindings), mutable~, deep~)
    UnionT(ts) => union(ts.map(u => subst(u, bindings)))
    RecordT(name=None, fields~, methods~, mutable~, deep~, ns~) => {
      let fs : Map[String, Field] = Map([])
      for n, f in fields {
        fs[n] = { ..f, ty: subst(f.ty, bindings), }
      }
      RecordT(name=None, fields=fs, methods~, mutable~, deep~, ns~)
    }
    FnT(sigs) => FnT(sigs.map(s => subst_sig(s, bindings)))
    _ => t
  }
}

///|
/// t with the type parameters nothing bound replaced by unknown.
pub fn ground(t : Ty) -> Ty {
  match t {
    VarT(_) => UnknownT
    ListT(elem~, mutable~, deep~) => ListT(elem=ground(elem), mutable~, deep~)
    TupleT(elems~, mutable~, deep~) =>
      TupleT(elems=elems.map(ground), mutable~, deep~)
    DictT(value~, mutable~, deep~) =>
      DictT(value=ground(value), mutable~, deep~)
    UnionT(ts) => union(ts.map(ground))
    RecordT(name=None, fields~, methods~, mutable~, deep~, ns~) => {
      let fs : Map[String, Field] = Map([])
      for n, f in fields {
        fs[n] = { ..f, ty: ground(f.ty), }
      }
      RecordT(name=None, fields=fs, methods~, mutable~, deep~, ns~)
    }
    FnT(sigs) =>
      FnT(
        sigs.map(s => {
          ..s,
          params: s.params.map(p => { ..p, ty: ground(p.ty), }),
          result: ground(s.result),
        }),
      )
    _ => t
  }
}

///|
pub fn subst_sig(s : Sig, bindings : Map[String, Ty]) -> Sig {
  {
    type_params: s.type_params.filter(p => bindings.get(p) is None),
    params: s.params.map(p => { ..p, ty: subst(p.ty, bindings), }),
    result: subst(s.result, bindings),
  }
}

///|
pub fn has_vars(t : Ty) -> Bool {
  match t {
    VarT(_) => true
    ListT(elem~, ..) => has_vars(elem)
    TupleT(elems~, ..) => elems.iter().any(has_vars)
    DictT(value~, ..) => has_vars(value)
    UnionT(ts) => ts.iter().any(has_vars)
    FnT(sigs) =>
      sigs
      .iter()
      .any(s => s.params.iter().any(p => has_vars(p.ty)) || has_vars(s.result))
    _ => false
  }
}
