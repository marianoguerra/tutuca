// The printer, as the reference's lib/print.js: a tree back to source,
// parenthesized by precedence. With types it prints the annotations too
// (TypeScript); without, JavaScript.

///|
fn binary_prec(op : String) -> Int32 {
  match op {
    "??" | "||" => 4
    "&&" => 5
    "|" => 6
    "^" => 7
    "&" => 8
    "==" | "!=" | "===" | "!==" => 9
    "<" | ">" | "<=" | ">=" | "in" | "instanceof" => 10
    "<<" | ">>" | ">>>" => 11
    "+" | "-" => 12
    "*" | "/" | "%" => 13
    "**" => 14
    _ => 18
  }
}

///|
let unary_prec = 15

///|
let postfix_prec = 16

///|
let call_prec = 17

///|
fn prec_of(e : @ast.Expr) -> Int32 {
  match e {
    Assign(..) | Arrow(_) => 1
    Cond(..) => 2
    Logical(op~, ..) | Binary(op~, ..) => binary_prec(op)
    Unary(..) => unary_prec
    Update(prefix~, ..) => if prefix { unary_prec } else { postfix_prec }
    Call(..) | Member(..) | Chain(_, ..) => call_prec
    _ => 18
  }
}

///|
priv struct Printer {
  types : Bool
  /// Where the statement being printed starts, for nested blocks.
  mut indent : String
}

///|
fn Printer::ann(self : Printer, t : @ast.TypeNode?) -> String {
  match t {
    Some(node) if self.types => ": \{self.type_(node)}"
    _ => ""
  }
}

///|
fn json_quote(s : String) -> String {
  Json::string(s).stringify()
}

///|
fn number_raw(raw : String) -> String {
  raw
}

///|
fn Printer::pattern(self : Printer, p : @ast.Pattern?) -> String {
  match p {
    None => ""
    Some(PIdent(id)) => "\{id.name}\{self.ann(id.ann)}"
    Some(PArray(elements~, ann~, ..)) => {
      let trailing = if elements.last() is Some(None) { "," } else { "" }
      "[\{elements.map(e => self.pattern(e)).join(", ")}\{trailing}]\{self.ann(ann)}"
    }
    Some(PObject(props~, ann~, ..)) => {
      let parts = props.map(prop => {
        match prop {
          PPRest(arg~, ..) => "...\{arg.name}"
          PPProp(value~, shorthand=true, ..) => self.pattern(Some(value))
          PPProp(key~, value~, ..) =>
            "\{self.key(key)}: \{self.pattern(Some(value))}"
        }
      })
      "{ \{parts.join(", ")} }\{self.ann(ann)}"
    }
    Some(PRest(arg~, ann~, ..)) =>
      "...\{self.pattern(Some(arg))}\{self.ann(ann)}"
    Some(PAssign(left~, right~, ..)) =>
      "\{self.pattern(Some(left))} = \{self.expr(right, 1)}"
  }
}

///|
fn Printer::key(self : Printer, k : @ast.PropKey) -> String {
  match k {
    KComputed(e) => "[\{self.expr(e, 1)}]"
    KIdent(id) => id.name
    KLit(v, raw~, ..) => literal(v, raw)
  }
}

///|
fn literal(v : @ast.Lit, raw : String) -> String {
  match v {
    LStr(s) => json_quote(s)
    LNum(_) => number_raw(raw)
    LBool(b) => b.to_string()
    LNull => "null"
  }
}

///|
fn Printer::params(self : Printer, f : @ast.Func) -> String {
  let parts = f.params.map(p => self.pattern(Some(p)))
  match f.this_type {
    Some(t) if self.types => parts.insert(0, "this: \{self.type_(t)}")
    _ => ()
  }
  "(\{parts.join(", ")})"
}

///|
fn Printer::function(
  self : Printer,
  f : @ast.Func,
  indent : String,
  form~ : @ast.Form = FunctionForm,
  name? : String,
) -> String {
  if f.arrow {
    let body = match f.body {
      ExprBody(e) => {
        let text = self.expr(e, 1)
        if e is ObjectLit(_, ..) {
          "(\{text})"
        } else {
          text
        }
      }
      BlockBody(b) => self.block(b, indent)
    }
    let bare = match f.params {
      [PIdent(id)] =>
        !(self.types && (id.ann is Some(_) || f.return_type is Some(_)))
      _ => false
    }
    let params = if bare {
      match f.params[0] {
        PIdent(id) => id.name
        _ => ""
      }
    } else {
      self.params(f)
    }
    return "\{params}\{self.ann(f.return_type)} => \{body}"
  }
  let head = match form {
    MethodForm => name.unwrap_or("")
    GetterForm => "get \{name.unwrap_or("")}"
    _ =>
      match f.id {
        Some(id) => "function \{id.name}"
        None => "function "
      }
  }
  let body = match f.body {
    BlockBody(b) => self.block(b, indent)
    ExprBody(e) => self.expr(e, 0)
  }
  "\{head}\{self.params(f)}\{self.ann(f.return_type)} \{body}"
}

///|
fn Printer::block(self : Printer, b : @ast.Block, indent : String) -> String {
  if b.body.length() == 0 {
    return "{}"
  }
  let inner = indent + "\t"
  let saved = self.indent
  self.indent = inner
  let lines = b.body.map(s => "\{inner}\{self.statement(s, inner)}")
  self.indent = saved
  "{\n\{lines.join("\n")}\n\{indent}}"
}

///|
fn Printer::statement(self : Printer, s : @ast.Stmt, indent : String) -> String {
  match s {
    VarDecl(kind~, decls~, ..) => "\{self.declaration(kind, decls)};"
    ExprStmt(e, directive~, ..) => {
      let text = self.expr(e, 0)
      let wrap = text.has_prefix("{") ||
        text.has_prefix("function") ||
        text.has_prefix("let [") ||
        (directive is None && e is Lit(LStr(_), ..))
      if wrap {
        "(\{text});"
      } else {
        "\{text};"
      }
    }
    If(cond~, cons~, alt~, ..) => {
      let out = StringBuilder()
      out.write_string(
        "if (\{self.expr(cond, 0)}) \{self.nested(cons, indent)}",
      )
      match alt {
        Some(a) => {
          out.write_string(
            if cons is BlockStmt(_) {
              " "
            } else {
              "\n" + indent
            },
          )
          out.write_string("else \{self.nested(a, indent)}")
        }
        None => ()
      }
      out.to_string()
    }
    BlockStmt(b) => self.block(b, indent)
    Return(None, ..) => "return;"
    Return(Some(e), ..) => "return \{self.expr(e, 0)};"
    ForOf(left~, right~, body~, ..) => {
      let decl = match left {
        VarDecl(kind~, decls~, ..) => self.declaration(kind, decls)
        _ => ""
      }
      "for (\{decl} of \{self.expr(right, 1)}) \{self.nested(body, indent)}"
    }
    Break(_) => "break;"
    Continue(_) => "continue;"
    Throw(e, ..) => "throw \{self.expr(e, 0)};"
    Try(block~, handler~, finalizer~, ..) => {
      let out = StringBuilder()
      out.write_string("try \{self.block(block, indent)}")
      match handler {
        Some(h) => {
          let param = match h.param {
            Some(p) => "(\{self.pattern(Some(p))}) "
            None => ""
          }
          out.write_string(" catch \{param}\{self.block(h.body, indent)}")
        }
        None => ()
      }
      match finalizer {
        Some(f) => out.write_string(" finally \{self.block(f, indent)}")
        None => ()
      }
      out.to_string()
    }
  }
}

///|
fn Printer::nested(self : Printer, s : @ast.Stmt, indent : String) -> String {
  match s {
    BlockStmt(b) => self.block(b, indent)
    _ => self.statement(s, indent)
  }
}

///|
fn Printer::declaration(
  self : Printer,
  kind : String,
  decls : Array[@ast.Declarator],
) -> String {
  let parts = decls.map(d => {
    match d.init {
      None => self.pattern(Some(d.id))
      Some(e) => "\{self.pattern(Some(d.id))} = \{self.expr(e, 1)}"
    }
  })
  "\{kind} \{parts.join(", ")}"
}

///|
/// An expression printed where at least precedence min is needed.
fn Printer::expr(self : Printer, e : @ast.Expr, min : Int32) -> String {
  let text = self.expr_text(e)
  if prec_of(e) < min {
    "(\{text})"
  } else {
    text
  }
}

///|
fn Printer::expr_text(self : Printer, e : @ast.Expr) -> String {
  match e {
    Ident(id) => id.name
    This(_) => "this"
    Lit(v, raw~, ..) => literal(v, raw)
    Template(quasis~, exprs~, ..) => {
      let sb = StringBuilder()
      sb.write_char('`')
      for i, q in quasis {
        sb.write_string(q.raw)
        if i < exprs.length() {
          sb.write_string("${\{self.expr(exprs[i], 0)}}")
        }
      }
      sb.write_char('`')
      sb.to_string()
    }
    ArrayLit(elements, ..) => {
      let trailing = if elements.last() is Some(None) { "," } else { "" }
      let parts = elements.map(x => {
        match x {
          None => ""
          Some(y) => self.expr(y, 1)
        }
      })
      "[\{parts.join(", ")}\{trailing}]"
    }
    ObjectLit(members, ..) => {
      if members.length() == 0 {
        return "{}"
      }
      if has_methods(members) {
        return self.namespace_(members)
      }
      let parts = members.map(m => {
        match m {
          SpreadMember(x, ..) => "...\{self.expr(x, 1)}"
          Prop(key=KIdent(id), shorthand=true, ..) => id.name
          Prop(key~, value~, ..) => "\{self.key(key)}: \{self.expr(value, 1)}"
          Method(..) => ""
        }
      })
      "{ \{parts.join(", ")} }"
    }
    Spread(x, ..) => "...\{self.expr(x, 1)}"
    Member(object~, property~, computed~, optional~, ..) => {
      let o = self.callee(object)
      if computed {
        "\{o}\{if optional { "?." } else { "" }}[\{self.expr(property, 0)}]"
      } else {
        let name = match property {
          Ident(p) => p.name
          _ => ""
        }
        "\{o}\{if optional { "?." } else { "." }}\{name}"
      }
    }
    Call(callee~, args~, optional~, ..) =>
      "\{self.callee(callee)}\{if optional { "?." } else { "" }}(\{args.map(a => self.expr(a, 1)).join(", ")})"
    Chain(inner, ..) => self.expr_text(inner)
    Unary(op~, arg~, ..) => {
      let a = self.expr(arg, unary_prec)
      let word = op.length() > 0 && op[0] >= 'a' && op[0] <= 'z'
      let clash = (op == "-" && a.has_prefix("-")) ||
        (op == "+" && a.has_prefix("+"))
      "\{op}\{if word { " " } else { "" }}\{if clash { "(\{a})" } else { a }}"
    }
    Update(op~, prefix~, arg~, ..) =>
      if prefix {
        "\{op}\{self.expr(arg, unary_prec)}"
      } else {
        "\{self.expr(arg, postfix_prec)}\{op}"
      }
    Binary(op~, left~, right~, ..) | Logical(op~, left~, right~, ..) => {
      let p = binary_prec(op)
      let right_assoc = op == "**"
      let logical = e is Logical(..)
      let side = (x : @ast.Expr, extra : Int32) => {
        let mix = match x {
          Logical(op=xop, ..) => logical && (op == "??") != (xop == "??")
          _ => false
        }
        let text = self.expr(x, p + extra)
        if mix && !text.has_prefix("(") {
          "(\{text})"
        } else {
          text
        }
      }
      "\{side(left, if right_assoc { 1 } else { 0 })} \{op} \{side(right, if right_assoc { 0 } else { 1 })}"
    }
    Cond(cond~, cons~, alt~, ..) =>
      "\{self.expr(cond, 3)} ? \{self.expr(cons, 1)} : \{self.expr(alt, 1)}"
    Assign(op~, left~, right~, ..) =>
      "\{self.expr(left, call_prec)} \{op} \{self.expr(right, 1)}"
    Arrow(f) => self.function(f, self.indent)
  }
}

///|
/// The object of a member or the callee of a call: a parenthesized chain stays
/// one, a number gets parentheses so its dot isn't a decimal point.
fn Printer::callee(self : Printer, e : @ast.Expr) -> String {
  match e {
    Chain(inner, ..) => "(\{self.expr_text(inner)})"
    Lit(LNum(_), raw~, ..) => "(\{raw})"
    _ => self.expr(e, call_prec)
  }
}

///|
fn Printer::type_(self : Printer, t : @ast.TypeNode) -> String {
  match t {
    TKeyword(name, _) => name
    TLiteral(LStr(s), _) => json_quote(s)
    TLiteral(LNum(n), _) => n.to_string()
    TLiteral(LBool(b), _) => b.to_string()
    TLiteral(LNull, _) => "null"
    TArray(element, _) => {
      let inner = self.type_(element)
      if element is (TUnion(_, _) | TFunction(..)) {
        "(\{inner})[]"
      } else {
        "\{inner}[]"
      }
    }
    TTuple(es, _) => "[\{es.map(x => self.type_(x)).join(", ")}]"
    TUnion(ts, _) =>
      ts
      .map(x => {
        if x is TFunction(..) {
          "(\{self.type_(x)})"
        } else {
          self.type_(x)
        }
      })
      .join(" | ")
    TRef(name, args, _) =>
      if args.length() == 0 {
        name
      } else {
        "\{name}<\{args.map(x => self.type_(x)).join(", ")}>"
      }
    TReadonly(operand, _) => "readonly \{self.type_(operand)}"
    TObject(members, _) =>
      if members.length() == 0 {
        "{}"
      } else {
        "{ \{members.map(m => self.type_member(m)).join("; ")} }"
      }
    TFunction(type_params~, params~, result~, ..) =>
      "\{type_params_text(type_params)}(\{params.map(p => self.type_param(p)).join(", ")}) => \{self.type_(result)}"
  }
}

///|
fn type_params_text(names : Array[String]) -> String {
  if names.length() == 0 {
    ""
  } else {
    "<\{names.join(", ")}>"
  }
}

///|
fn Printer::type_param(self : Printer, p : @ast.TypeParam) -> String {
  "\{if p.rest { "..." } else { "" }}\{p.name}\{if p.optional { "?" } else { "" }}: \{self.type_(p.value)}"
}

///|
fn member_name(name : String) -> String {
  let plain = name.length() > 0 &&
    name
    .iter()
    .all(c => {
      c.is_ascii_alphabetic() || c.is_ascii_digit() || c == '_' || c == '$'
    }) &&
    !name.get_char(0).unwrap().is_ascii_digit()
  if plain {
    name
  } else {
    json_quote(name)
  }
}

///|
fn Printer::type_member(self : Printer, m : @ast.TypeMember) -> String {
  match m {
    TMProperty(name~, optional~, read_only~, value~, ..) =>
      "\{if read_only { "readonly " } else { "" }}\{member_name(name)}\{if optional { "?" } else { "" }}: \{self.type_(value)}"
    TMMethod(name~, optional~, type_params~, params~, result~, ..) =>
      "\{member_name(name)}\{if optional { "?" } else { "" }}\{type_params_text(type_params)}(\{params.map(p => self.type_param(p)).join(", ")}): \{self.type_(result)}"
    TMIndex(key_name~, key~, value~, ..) =>
      "[\{key_name}: \{self.type_(key)}]: \{self.type_(value)}"
  }
}

///|
/// A program in the form it was written (a function, a method, a getter, an
/// arrow); with types, TypeScript.
pub fn print(program : @ast.Program, types~ : Bool = false) -> String {
  { types, indent: "", }.function(
    program.func,
    "",
    form=program.form,
    name?=program.name,
  )
}

///|
/// A program as a function expression, whatever its form.
pub fn print_function(program : @ast.Program, types~ : Bool = false) -> String {
  { types, indent: "", }.function(program.func, "")
}

///|
/// Whether an object literal holds methods or getters, itself or in the
/// object literals it holds.
fn has_methods(members : Array[@ast.ObjMember]) -> Bool {
  members
  .iter()
  .any(m => {
    match m {
      Method(..) => true
      Prop(value=ObjectLit(inner, ..), ..) => has_methods(inner)
      _ => false
    }
  })
}

///|
/// An object literal with methods and getters (a module's namespace): one
/// member a line.
fn Printer::namespace_(
  self : Printer,
  members : Array[@ast.ObjMember],
) -> String {
  let outer = self.indent
  let inner = outer + "\t"
  self.indent = inner
  let parts = members.map(m => {
    match m {
      SpreadMember(x, ..) => "...\{self.expr(x, 1)}"
      Method(key~, func~, getter~, ..) =>
        self.function(
          func,
          inner,
          form=if getter { GetterForm } else { MethodForm },
          name=self.key(key),
        )
      Prop(key=KIdent(id), shorthand=true, ..) => id.name
      Prop(key~, value~, ..) => "\{self.key(key)}: \{self.expr(value, 1)}"
    }
  })
  self.indent = outer
  "{\n\{parts.map(p => "\{inner}\{p},").join("\n")}\n\{outer}}"
}

///|
fn Printer::item(self : Printer, i : @ast.Item) -> String {
  match i {
    Export(d, ..) => "export \{self.item(d)}"
    Import(type_only~, specs~, source~, ..) => {
      let names = specs.map(sp => {
        if sp.imported.name == sp.local_.name {
          sp.local_.name
        } else {
          "\{sp.imported.name} as \{sp.local_.name}"
        }
      })
      "import \{if type_only { "type " } else { "" }}{ \{names.join(", ")} } from \{json_quote(source)};"
    }
    Const(s) => self.statement(s, "")
    FunctionDecl(f) => self.function(f, "")
    TypeAlias(id~, value~, ..) => "type \{id.name} = \{self.type_(value)};"
    Interface(id~, body~, ..) => "interface \{id.name} \{self.type_(body)}"
  }
}

///|
/// A module; without types, without its type items and type imports.
pub fn print_module(m : @ast.Module, types~ : Bool = false) -> String {
  let p : Printer = { types, indent: "", }
  m.items.filter(i => types || !i.is_type_item()).map(i => p.item(i)).join("\n")
}

///|
/// A type as TypeScript writes it.
pub fn print_type(t : @ast.TypeNode) -> String {
  ({ types: true, indent: "", } : Printer).type_(t)
}
