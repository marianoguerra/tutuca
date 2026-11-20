// The tree as the reference's goldens record it: ESTree JSON without positions
// (and without the source). Optional fields (typeAnnotation, returnType,
// directive) appear only when there is something in them, as in the reference.

///|
fn obj(kind : String, fields : Array[(String, Json)]) -> Json {
  let m : Map[String, Json] = { "type": Json::string(kind) }
  for f in fields {
    m[f.0] = f.1
  }
  Json::object(m)
}

///|
fn opt(m : Json, key : String, value : Json?) -> Json {
  match (m, value) {
    (Object(map), Some(v)) => {
      map[key] = v
      m
    }
    _ => m
  }
}

///|
pub fn lit_json(l : Lit) -> Json {
  match l {
    LNull => Json::null()
    LBool(b) => Json::boolean(b)
    LNum(n) => Json::number(n)
    LStr(s) => Json::string(s)
  }
}

///|
pub fn Ident::to_json(self : Ident) -> Json {
  opt(
    obj("Identifier", [("name", Json::string(self.name))]),
    "typeAnnotation",
    self.ann.map(type_json),
  )
}

///|
fn strings(xs : Array[String]) -> Json {
  Json::array(xs.map(Json::string))
}

///|
pub fn type_json(t : TypeNode) -> Json {
  match t {
    TKeyword(name, _) => obj("TypeKeyword", [("name", Json::string(name))])
    TLiteral(v, _) => obj("TypeLiteral", [("value", lit_json(v))])
    TArray(e, _) => obj("TypeArray", [("element", type_json(e))])
    TTuple(es, _) =>
      obj("TypeTuple", [("elements", Json::array(es.map(type_json)))])
    TObject(ms, _) =>
      obj("TypeObject", [("members", Json::array(ms.map(member_json)))])
    TUnion(ts, _) =>
      obj("TypeUnion", [("types", Json::array(ts.map(type_json)))])
    TRef(name, args, _) =>
      obj("TypeRef", [
        ("name", Json::string(name)),
        ("args", Json::array(args.map(type_json))),
      ])
    TFunction(type_params~, params~, result~, ..) =>
      obj("TypeFunction", [
        ("typeParams", strings(type_params)),
        ("params", Json::array(params.map(param_json))),
        ("result", type_json(result)),
      ])
    TReadonly(operand, _) =>
      obj("TypeReadonly", [("operand", type_json(operand))])
  }
}

///|
fn param_json(p : TypeParam) -> Json {
  obj("TypeParam", [
    ("name", Json::string(p.name)),
    ("optional", Json::boolean(p.optional)),
    ("rest", Json::boolean(p.rest)),
    ("value", type_json(p.value)),
  ])
}

///|
fn member_json(m : TypeMember) -> Json {
  match m {
    TMProperty(name~, optional~, read_only~, value~, ..) =>
      obj("TypeProperty", [
        ("name", Json::string(name)),
        ("optional", Json::boolean(optional)),
        ("readonly", Json::boolean(read_only)),
        ("value", type_json(value)),
      ])
    TMMethod(name~, optional~, type_params~, params~, result~, ..) =>
      obj("TypeMethod", [
        ("name", Json::string(name)),
        ("optional", Json::boolean(optional)),
        ("typeParams", strings(type_params)),
        ("params", Json::array(params.map(param_json))),
        ("result", type_json(result)),
      ])
    TMIndex(key_name~, key~, value~, ..) =>
      obj("TypeIndex", [
        ("keyName", Json::string(key_name)),
        ("key", type_json(key)),
        ("value", type_json(value)),
      ])
  }
}

///|
fn key_json(k : PropKey) -> Json {
  match k {
    KIdent(id) => id.to_json()
    KLit(v, raw~, ..) =>
      obj("Literal", [("value", lit_json(v)), ("raw", Json::string(raw))])
    KComputed(e) => expr_json(e)
  }
}

///|
pub fn pattern_json(p : Pattern) -> Json {
  match p {
    PIdent(id) => id.to_json()
    PArray(elements~, ann~, ..) =>
      opt(
        obj("ArrayPattern", [
          (
            "elements",
            Json::array(
              elements.map(e => {
                match e {
                  Some(p) => pattern_json(p)
                  None => Json::null()
                }
              }),
            ),
          ),
        ]),
        "typeAnnotation",
        ann.map(type_json),
      )
    PObject(props~, ann~, ..) =>
      opt(
        obj("ObjectPattern", [
          (
            "properties",
            Json::array(
              props.map(prop => {
                match prop {
                  PPProp(key~, value~, shorthand~, ..) =>
                    obj("Property", [
                      ("method", Json::boolean(false)),
                      ("shorthand", Json::boolean(shorthand)),
                      ("computed", Json::boolean(key is KComputed(_))),
                      ("key", key_json(key)),
                      ("value", pattern_json(value)),
                      ("kind", Json::string("init")),
                    ])
                  PPRest(arg~, ..) =>
                    obj("RestElement", [("argument", arg.to_json())])
                }
              }),
            ),
          ),
        ]),
        "typeAnnotation",
        ann.map(type_json),
      )
    PRest(arg~, ann~, ..) =>
      opt(
        obj("RestElement", [("argument", pattern_json(arg))]),
        "typeAnnotation",
        ann.map(type_json),
      )
    PAssign(left~, right~, ..) =>
      obj("AssignmentPattern", [
        ("left", pattern_json(left)),
        ("right", expr_json(right)),
      ])
  }
}

///|
pub fn expr_json(e : Expr) -> Json {
  match e {
    Ident(id) => id.to_json()
    This(_) => obj("ThisExpression", [])
    Lit(v, raw~, ..) =>
      obj("Literal", [("value", lit_json(v)), ("raw", Json::string(raw))])
    Template(quasis~, exprs~, ..) =>
      obj("TemplateLiteral", [
        ("expressions", Json::array(exprs.map(expr_json))),
        (
          "quasis",
          Json::array(
            quasis.map(q => {
              obj("TemplateElement", [
                (
                  "value",
                  Json::object({
                    "raw": Json::string(q.raw),
                    "cooked": Json::string(q.cooked),
                  }),
                ),
                ("tail", Json::boolean(q.tail)),
              ])
            }),
          ),
        ),
      ])
    ArrayLit(elements, ..) =>
      obj("ArrayExpression", [
        (
          "elements",
          Json::array(
            elements.map(x => {
              match x {
                Some(e) => expr_json(e)
                None => Json::null()
              }
            }),
          ),
        ),
      ])
    ObjectLit(members, ..) =>
      obj("ObjectExpression", [
        (
          "properties",
          Json::array(
            members.map(m => {
              match m {
                Prop(key~, value~, shorthand~, ..) =>
                  obj("Property", [
                    ("method", Json::boolean(false)),
                    ("shorthand", Json::boolean(shorthand)),
                    ("computed", Json::boolean(key is KComputed(_))),
                    ("key", key_json(key)),
                    ("value", expr_json(value)),
                    ("kind", Json::string("init")),
                  ])
                SpreadMember(arg, ..) =>
                  obj("SpreadElement", [("argument", expr_json(arg))])
                Method(key~, func~, getter~, ..) =>
                  obj("Property", [
                    ("method", Json::boolean(!getter)),
                    ("shorthand", Json::boolean(false)),
                    ("computed", Json::boolean(false)),
                    ("key", key_json(key)),
                    ("value", func_json(func)),
                    ("kind", Json::string(if getter { "get" } else { "init" })),
                  ])
              }
            }),
          ),
        ),
      ])
    Member(object~, property~, computed~, optional~, ..) =>
      obj("MemberExpression", [
        ("object", expr_json(object)),
        ("property", expr_json(property)),
        ("computed", Json::boolean(computed)),
        ("optional", Json::boolean(optional)),
      ])
    Call(callee~, args~, optional~, ..) =>
      obj("CallExpression", [
        ("callee", expr_json(callee)),
        ("arguments", Json::array(args.map(expr_json))),
        ("optional", Json::boolean(optional)),
      ])
    Spread(arg, ..) => obj("SpreadElement", [("argument", expr_json(arg))])
    Chain(inner, ..) =>
      obj("ChainExpression", [("expression", expr_json(inner))])
    Unary(op~, arg~, ..) =>
      obj("UnaryExpression", [
        ("operator", Json::string(op)),
        ("prefix", Json::boolean(true)),
        ("argument", expr_json(arg)),
      ])
    Update(op~, prefix~, arg~, ..) =>
      obj("UpdateExpression", [
        ("operator", Json::string(op)),
        ("prefix", Json::boolean(prefix)),
        ("argument", expr_json(arg)),
      ])
    Binary(op~, left~, right~, ..) =>
      obj("BinaryExpression", [
        ("left", expr_json(left)),
        ("operator", Json::string(op)),
        ("right", expr_json(right)),
      ])
    Logical(op~, left~, right~, ..) =>
      obj("LogicalExpression", [
        ("left", expr_json(left)),
        ("operator", Json::string(op)),
        ("right", expr_json(right)),
      ])
    Assign(op~, left~, right~, ..) =>
      obj("AssignmentExpression", [
        ("operator", Json::string(op)),
        ("left", expr_json(left)),
        ("right", expr_json(right)),
      ])
    Cond(cond~, cons~, alt~, ..) =>
      obj("ConditionalExpression", [
        ("test", expr_json(cond)),
        ("consequent", expr_json(cons)),
        ("alternate", expr_json(alt)),
      ])
    Arrow(f) => func_json(f)
  }
}

///|
fn block_json(b : Block) -> Json {
  obj("BlockStatement", [("body", Json::array(b.body.map(stmt_json)))])
}

///|
pub fn func_json(f : Func) -> Json {
  let body = match f.body {
    BlockBody(b) => block_json(b)
    ExprBody(e) => expr_json(e)
  }
  let j = if f.arrow {
    obj("ArrowFunctionExpression", [
      ("id", Json::null()),
      ("expression", Json::boolean(f.body is ExprBody(_))),
      ("generator", Json::boolean(false)),
      ("async", Json::boolean(false)),
      ("params", Json::array(f.params.map(pattern_json))),
      ("body", body),
    ])
  } else {
    obj(if f.decl { "FunctionDeclaration" } else { "FunctionExpression" }, [
      (
        "id",
        match f.id {
          Some(id) => id.to_json()
          None => Json::null()
        },
      ),
      ("expression", Json::boolean(false)),
      ("generator", Json::boolean(false)),
      ("async", Json::boolean(false)),
      ("params", Json::array(f.params.map(pattern_json))),
      ("body", body),
    ])
  }
  opt(
    opt(j, "thisType", f.this_type.map(type_json)),
    "returnType",
    f.return_type.map(type_json),
  )
}

///|
fn declaration_json(kind : String, decls : Array[Declarator]) -> Json {
  obj("VariableDeclaration", [
    (
      "declarations",
      Json::array(
        decls.map(d => {
          obj("VariableDeclarator", [
            ("id", pattern_json(d.id)),
            (
              "init",
              match d.init {
                Some(e) => expr_json(e)
                None => Json::null()
              },
            ),
          ])
        }),
      ),
    ),
    ("kind", Json::string(kind)),
  ])
}

///|
pub fn stmt_json(s : Stmt) -> Json {
  match s {
    VarDecl(kind~, decls~, ..) => declaration_json(kind, decls)
    ExprStmt(e, directive~, ..) =>
      opt(
        obj("ExpressionStatement", [("expression", expr_json(e))]),
        "directive",
        directive.map(Json::string),
      )
    If(cond~, cons~, alt~, ..) =>
      obj("IfStatement", [
        ("test", expr_json(cond)),
        ("consequent", stmt_json(cons)),
        (
          "alternate",
          match alt {
            Some(a) => stmt_json(a)
            None => Json::null()
          },
        ),
      ])
    BlockStmt(b) => block_json(b)
    Return(arg, ..) =>
      obj("ReturnStatement", [
        (
          "argument",
          match arg {
            Some(e) => expr_json(e)
            None => Json::null()
          },
        ),
      ])
    ForOf(left~, right~, body~, ..) =>
      obj("ForOfStatement", [
        ("await", Json::boolean(false)),
        ("left", stmt_json(left)),
        ("right", expr_json(right)),
        ("body", stmt_json(body)),
      ])
    Try(block~, handler~, finalizer~, ..) =>
      obj("TryStatement", [
        ("block", block_json(block)),
        (
          "handler",
          match handler {
            Some(h) =>
              obj("CatchClause", [
                (
                  "param",
                  match h.param {
                    Some(p) => pattern_json(p)
                    None => Json::null()
                  },
                ),
                ("body", block_json(h.body)),
              ])
            None => Json::null()
          },
        ),
        (
          "finalizer",
          match finalizer {
            Some(b) => block_json(b)
            None => Json::null()
          },
        ),
      ])
    Throw(e, ..) => obj("ThrowStatement", [("argument", expr_json(e))])
    Break(_) => obj("BreakStatement", [("label", Json::null())])
    Continue(_) => obj("ContinueStatement", [("label", Json::null())])
  }
}

///|
/// The program as the goldens record it.
pub fn to_json(p : Program) -> Json {
  obj("PureProgram", [
    ("form", Json::string(p.form.name())),
    (
      "name",
      match p.name {
        Some(n) => Json::string(n)
        None => Json::null()
      },
    ),
    ("function", func_json(p.func)),
  ])
}

///|
fn ident_json(id : Ident) -> Json {
  obj("Identifier", [("name", Json::string(id.name))])
}

///|
pub fn item_json(i : Item) -> Json {
  match i {
    Import(type_only~, specs~, ..) =>
      obj("ImportDeclaration", [
        ("importKind", Json::string(if type_only { "type" } else { "value" })),
        (
          "specifiers",
          Json::array(
            specs.map(sp => {
              obj("ImportSpecifier", [
                ("imported", ident_json(sp.imported)),
                ("local", ident_json(sp.local_)),
              ])
            }),
          ),
        ),
        // As the goldens record it: without source, as the reference strips
        // a tree of its positions and sources.
        ("attributes", Json::array([])),
      ])
    Export(d, ..) =>
      obj("ExportNamedDeclaration", [
        ("declaration", item_json(d)),
        ("specifiers", Json::array([])),
        ("attributes", Json::array([])),
      ])
    Const(s) => stmt_json(s)
    FunctionDecl(f) => func_json(f)
    TypeAlias(id~, value~, ..) =>
      obj("TypeAlias", [
        ("id", ident_json(id)),
        ("typeAnnotation", type_json(value)),
      ])
    Interface(id~, body~, ..) =>
      obj("InterfaceDeclaration", [
        ("id", ident_json(id)),
        ("body", type_json(body)),
      ])
  }
}

///|
/// The module as the goldens record it.
pub fn module_json(m : Module) -> Json {
  obj("PureModule", [("items", Json::array(m.items.map(item_json)))])
}
