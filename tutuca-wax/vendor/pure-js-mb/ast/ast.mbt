// The tree: the reference's ESTree nodes (acorn's, plus a PureProgram root
// and TypeScript annotations) as closed enums, one constructor per node kind.
// `to_json` (json.mbt) writes them as the reference's goldens record them,
// without positions. Spans are UTF-16 offsets into the source.

///|
#derive(Eq, Debug)
pub(all) struct Span {
  start : Int32
  end : Int32
}

///|
#derive(Eq, Debug)
pub(all) enum Lit {
  LNull
  LBool(Bool)
  LNum(Double)
  LStr(String)
}

///|
/// A name. `ann` is its type annotation, where a binding has one.
#derive(Eq, Debug)
pub(all) struct Ident {
  name : String
  span : Span
  ann : TypeNode?
}

///|
#derive(Eq, Debug)
pub(all) enum TypeNode {
  TKeyword(String, Span)
  TLiteral(Lit, Span)
  TArray(TypeNode, Span)
  TTuple(Array[TypeNode], Span)
  TObject(Array[TypeMember], Span)
  TUnion(Array[TypeNode], Span)
  TRef(String, Array[TypeNode], Span)
  TFunction(
    type_params~ : Array[String],
    params~ : Array[TypeParam],
    result~ : TypeNode,
    span~ : Span
  )
  TReadonly(TypeNode, Span)
}

///|
#derive(Eq, Debug)
pub(all) enum TypeMember {
  TMProperty(
    name~ : String,
    optional~ : Bool,
    read_only~ : Bool,
    value~ : TypeNode,
    span~ : Span
  )
  TMMethod(
    name~ : String,
    optional~ : Bool,
    type_params~ : Array[String],
    params~ : Array[TypeParam],
    result~ : TypeNode,
    span~ : Span
  )
  TMIndex(key_name~ : String, key~ : TypeNode, value~ : TypeNode, span~ : Span)
}

///|
#derive(Eq, Debug)
pub(all) struct TypeParam {
  name : String
  optional : Bool
  rest : Bool
  value : TypeNode
  span : Span
}

///|
/// A property key: a name, a literal, or a computed expression.
#derive(Eq, Debug)
pub(all) enum PropKey {
  KIdent(Ident)
  KLit(Lit, raw~ : String, span~ : Span)
  KComputed(Expr)
}

///|
#derive(Eq, Debug)
pub(all) enum Pattern {
  PIdent(Ident)
  PArray(elements~ : Array[Pattern?], ann~ : TypeNode?, span~ : Span)
  PObject(props~ : Array[PatProp], ann~ : TypeNode?, span~ : Span)
  PRest(arg~ : Pattern, ann~ : TypeNode?, span~ : Span)
  PAssign(left~ : Pattern, right~ : Expr, span~ : Span)
}

///|
#derive(Eq, Debug)
pub(all) enum PatProp {
  PPProp(key~ : PropKey, value~ : Pattern, shorthand~ : Bool, span~ : Span)
  PPRest(arg~ : Ident, span~ : Span)
}

///|
#derive(Eq, Debug)
pub(all) struct Quasi {
  raw : String
  cooked : String
  tail : Bool
  span : Span
}

///|
#derive(Eq, Debug)
pub(all) enum ObjMember {
  Prop(key~ : PropKey, value~ : Expr, shorthand~ : Bool, span~ : Span)
  SpreadMember(Expr, span~ : Span)
  /// A method or a getter: only a module's namespaces have them (the sieve
  /// says where they may be).
  Method(key~ : PropKey, func~ : Func, getter~ : Bool, span~ : Span)
}

///|
#derive(Eq, Debug)
pub(all) enum Expr {
  Ident(Ident)
  This(Span)
  Lit(Lit, raw~ : String, span~ : Span)
  Template(quasis~ : Array[Quasi], exprs~ : Array[Expr], span~ : Span)
  /// None is a hole; a spread element is a Spread.
  ArrayLit(Array[Expr?], span~ : Span)
  ObjectLit(Array[ObjMember], span~ : Span)
  /// A non-computed property is an Ident.
  Member(
    object~ : Expr,
    property~ : Expr,
    computed~ : Bool,
    optional~ : Bool,
    span~ : Span
  )
  Call(callee~ : Expr, args~ : Array[Expr], optional~ : Bool, span~ : Span)
  Spread(Expr, span~ : Span)
  Chain(Expr, span~ : Span)
  Unary(op~ : String, arg~ : Expr, span~ : Span)
  Update(op~ : String, prefix~ : Bool, arg~ : Expr, span~ : Span)
  Binary(op~ : String, left~ : Expr, right~ : Expr, span~ : Span)
  Logical(op~ : String, left~ : Expr, right~ : Expr, span~ : Span)
  Assign(op~ : String, left~ : Expr, right~ : Expr, span~ : Span)
  Cond(cond~ : Expr, cons~ : Expr, alt~ : Expr, span~ : Span)
  Arrow(Func)
}

///|
#derive(Eq, Debug)
pub(all) struct Block {
  body : Array[Stmt]
  span : Span
}

///|
#derive(Eq, Debug)
pub(all) enum Body {
  BlockBody(Block)
  ExprBody(Expr)
}

///|
/// A function expression, an arrow, or (decl) a module's function
/// declaration. this_type is TypeScript's this parameter.
#derive(Eq, Debug)
pub(all) struct Func {
  id : Ident?
  this_type : TypeNode?
  params : Array[Pattern]
  body : Body
  return_type : TypeNode?
  arrow : Bool
  decl : Bool
  span : Span
}

///|
#derive(Eq, Debug)
pub(all) struct Declarator {
  id : Pattern
  init : Expr?
  span : Span
}

///|
#derive(Eq, Debug)
pub(all) struct CatchClause {
  param : Pattern?
  body : Block
  span : Span
}

///|
#derive(Eq, Debug)
pub(all) enum Stmt {
  VarDecl(kind~ : String, decls~ : Array[Declarator], span~ : Span)
  ExprStmt(Expr, directive~ : String?, span~ : Span)
  If(cond~ : Expr, cons~ : Stmt, alt~ : Stmt?, span~ : Span)
  BlockStmt(Block)
  Return(Expr?, span~ : Span)
  ForOf(left~ : Stmt, right~ : Expr, body~ : Stmt, span~ : Span)
  Try(
    block~ : Block,
    handler~ : CatchClause?,
    finalizer~ : Block?,
    span~ : Span
  )
  Throw(Expr, span~ : Span)
  Break(Span)
  Continue(Span)
}

///|
#derive(Eq, Debug)
pub(all) enum Form {
  FunctionForm
  MethodForm
  GetterForm
  ArrowForm
}

///|
pub fn Form::name(self : Form) -> String {
  match self {
    FunctionForm => "function"
    MethodForm => "method"
    GetterForm => "getter"
    ArrowForm => "arrow"
  }
}

///|
/// A program: one function, in the form it was written, and its source.
#derive(Eq, Debug)
pub(all) struct Program {
  form : Form
  name : String?
  func : Func
  span : Span
  source : String
}

///|
/// What a module imports from a specifier: imported, as local.
#derive(Eq, Debug)
pub(all) struct ImportSpec {
  imported : Ident
  local_ : Ident
  span : Span
}

///|
/// A module's item.
#derive(Eq, Debug)
pub(all) enum Item {
  Import(
    type_only~ : Bool,
    specs~ : Array[ImportSpec],
    source~ : String,
    raw~ : String,
    source_span~ : Span,
    span~ : Span
  )
  Export(Item, span~ : Span)
  /// A const declaration (a VarDecl).
  Const(Stmt)
  FunctionDecl(Func)
  TypeAlias(id~ : Ident, value~ : TypeNode, span~ : Span)
  Interface(id~ : Ident, body~ : TypeNode, span~ : Span)
}

///|
/// A module: its items, and its source.
#derive(Eq, Debug)
pub(all) struct Module {
  items : Array[Item]
  span : Span
  source : String
}

///|
pub fn Item::span(self : Item) -> Span {
  match self {
    Import(span~, ..)
    | Export(_, span~)
    | TypeAlias(span~, ..)
    | Interface(span~, ..) => span
    Const(s) => s.span()
    FunctionDecl(f) => f.span
  }
}

///|
/// The declaration an item makes: an export's.
pub fn Item::declaration(self : Item) -> Item {
  match self {
    Export(d, ..) => d
    d => d
  }
}

///|
/// What an item declares only for types: it goes when types are erased.
pub fn Item::is_type_item(self : Item) -> Bool {
  match self.declaration() {
    TypeAlias(..) | Interface(..) | Import(type_only=true, ..) => true
    _ => false
  }
}

///|
pub fn Expr::span(self : Expr) -> Span {
  match self {
    Ident(id) => id.span
    This(s) => s
    Arrow(f) => f.span
    Lit(_, span~, ..)
    | Template(span~, ..)
    | ArrayLit(_, span~)
    | ObjectLit(_, span~)
    | Member(span~, ..)
    | Call(span~, ..)
    | Spread(_, span~)
    | Chain(_, span~)
    | Unary(span~, ..)
    | Update(span~, ..)
    | Binary(span~, ..)
    | Logical(span~, ..)
    | Assign(span~, ..)
    | Cond(span~, ..) => span
  }
}

///|
pub fn Stmt::span(self : Stmt) -> Span {
  match self {
    BlockStmt(b) => b.span
    Break(s) | Continue(s) => s
    VarDecl(span~, ..)
    | ExprStmt(_, span~, ..)
    | If(span~, ..)
    | Return(_, span~)
    | ForOf(span~, ..)
    | Try(span~, ..)
    | Throw(_, span~) => span
  }
}

///|
pub fn Pattern::span(self : Pattern) -> Span {
  match self {
    PIdent(id) => id.span
    PArray(span~, ..)
    | PObject(span~, ..)
    | PRest(span~, ..)
    | PAssign(span~, ..) => span
  }
}

///|
pub fn Pattern::ann(self : Pattern) -> TypeNode? {
  match self {
    PIdent(id) => id.ann
    PArray(ann~, ..) | PObject(ann~, ..) | PRest(ann~, ..) => ann
    PAssign(..) => None
  }
}

///|
pub fn TypeNode::span(self : TypeNode) -> Span {
  match self {
    TKeyword(_, s)
    | TLiteral(_, s)
    | TArray(_, s)
    | TTuple(_, s)
    | TObject(_, s)
    | TUnion(_, s)
    | TRef(_, _, s)
    | TReadonly(_, s) => s
    TFunction(span~, ..) => span
  }
}

///|
pub fn PropKey::span(self : PropKey) -> Span {
  match self {
    KIdent(id) => id.span
    KLit(_, span~, ..) => span
    KComputed(e) => e.span()
  }
}

///|
/// The names a pattern binds, in order.
pub fn Pattern::bound_names(self : Pattern) -> Array[String] {
  let out = []
  fn go(p : Pattern) {
    match p {
      PIdent(id) => out.push(id.name)
      PArray(elements~, ..) =>
        for e in elements {
          if e is Some(p) {
            go(p)
          }
        }
      PObject(props~, ..) =>
        for prop in props {
          match prop {
            PPProp(value~, ..) => go(value)
            PPRest(arg~, ..) => out.push(arg.name)
          }
        }
      PRest(arg~, ..) => go(arg)
      PAssign(left~, ..) => go(left)
    }
  }

  go(self)
  out
}

///|
/// Whether the tree has a type annotation anywhere.
pub fn Program::typed(self : Program) -> Bool {
  self.func.return_type is Some(_) ||
  to_json(self).stringify().contains("\"typeAnnotation\"")
}
