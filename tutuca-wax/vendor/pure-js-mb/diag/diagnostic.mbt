// What every stage reports: a Diagnostic, data with a code, the stage that
// found it, a span (UTF-16 offsets, as the reference's), and, for a form pure-js
// leaves out, whether it is excluded by design or omitted from this version.

///|
#derive(Eq, Debug)
pub(all) enum Stage {
  Parse
  Sieve
  Check
  Compile
  Run
}

///|
pub fn Stage::name(self : Stage) -> String {
  match self {
    Parse => "parse"
    Sieve => "sieve"
    Check => "check"
    Compile => "compile"
    Run => "run"
  }
}

///|
/// The checker's diagnostics, by what is wrong.
#derive(Eq, Debug)
pub(all) enum CheckCode {
  UnknownName
  ShadowedName
  ThisUnavailable
  PatternType
  TooManyParams
  ParamType
  MissingParamType
  UnknownType
  ReturnType
  ReturnValue
  MissingReturn
  UnreachableCode
  NotAssignable
  NotTestable
  ModuleAsValue
  FunctionAsValue
  VoidValue
  TemplateType
  OperandType
  ComparisonType
  UnknownMember
  ReservedName
  PossiblyNull
  MethodNotCalled
  UnknownProperty
  DictDotAccess
  IndexType
  RecordComputedKey
  NotCallable
  NondeterministicCall
  MethodOnUnion
  UnknownMethod
  ImmutableTarget
  NoMatchingOverload
  WrongArity
  SpreadType
  ArgumentType
  CallbackArity
  CallbackType
  EmptyArrayType
  DuplicateKey
  ExcessProperty
  MissingProperty
  ReadonlyProperty
  LetNeedsValue
  NotIterable
  ConstAssignment
  ImmutableArgument
  NamespaceAsValue
  EntryAccess
  ModulePattern
  UnknownImport
  ImportCycle
  ImportError
  TypeNameClash
  RecursiveCall
  ConstCycle
  ConstOrder
  NamespaceAnnotation
  NamespaceSpread
  HelperThis
}

///|
pub fn CheckCode::name(self : CheckCode) -> String {
  match self {
    UnknownName => "unknown-name"
    ShadowedName => "shadowed-name"
    ThisUnavailable => "this-unavailable"
    PatternType => "pattern-type"
    TooManyParams => "too-many-params"
    ParamType => "param-type"
    MissingParamType => "missing-param-type"
    UnknownType => "unknown-type"
    ReturnType => "return-type"
    ReturnValue => "return-value"
    MissingReturn => "missing-return"
    UnreachableCode => "unreachable-code"
    NotAssignable => "not-assignable"
    NotTestable => "not-testable"
    ModuleAsValue => "module-as-value"
    FunctionAsValue => "function-as-value"
    VoidValue => "void-value"
    TemplateType => "template-type"
    OperandType => "operand-type"
    ComparisonType => "comparison-type"
    UnknownMember => "unknown-member"
    ReservedName => "reserved-name"
    PossiblyNull => "possibly-null"
    MethodNotCalled => "method-not-called"
    UnknownProperty => "unknown-property"
    DictDotAccess => "dict-dot-access"
    IndexType => "index-type"
    RecordComputedKey => "record-computed-key"
    NotCallable => "not-callable"
    NondeterministicCall => "nondeterministic-call"
    MethodOnUnion => "method-on-union"
    UnknownMethod => "unknown-method"
    ImmutableTarget => "immutable-target"
    NoMatchingOverload => "no-matching-overload"
    WrongArity => "wrong-arity"
    SpreadType => "spread-type"
    ArgumentType => "argument-type"
    CallbackArity => "callback-arity"
    CallbackType => "callback-type"
    EmptyArrayType => "empty-array-type"
    DuplicateKey => "duplicate-key"
    ExcessProperty => "excess-property"
    MissingProperty => "missing-property"
    ReadonlyProperty => "readonly-property"
    LetNeedsValue => "let-needs-value"
    NotIterable => "not-iterable"
    ConstAssignment => "const-assignment"
    ImmutableArgument => "immutable-argument"
    NamespaceAsValue => "namespace-as-value"
    EntryAccess => "entry-access"
    ModulePattern => "module-pattern"
    UnknownImport => "unknown-import"
    ImportCycle => "import-cycle"
    ImportError => "import-error"
    TypeNameClash => "type-name-clash"
    RecursiveCall => "recursive-call"
    ConstCycle => "const-cycle"
    ConstOrder => "const-order"
    NamespaceAnnotation => "namespace-annotation"
    NamespaceSpread => "namespace-spread"
    HelperThis => "helper-this"
  }
}

///|
/// A diagnostic's code: not JavaScript, a feature the program uses, a rule the
/// checker found broken, or the compiler's audit.
#derive(Eq, Debug)
pub(all) enum Code {
  SyntaxError
  Feature(@tables.Feature)
  Check(CheckCode)
  Audit
}

///|
/// The code as the reference spells it: kebab-case.
pub fn Code::name(self : Code) -> String {
  match self {
    SyntaxError => "syntax-error"
    Feature(f) => f.name()
    Check(c) => c.name()
    Audit => "audit"
  }
}

///|
#derive(Eq, Debug)
pub(all) enum Exclusion {
  ByDesign
  Omitted
}

///|
pub fn Exclusion::name(self : Exclusion) -> String {
  match self {
    ByDesign => "by-design"
    Omitted => "omitted"
  }
}

///|
#derive(Eq, Debug)
pub(all) struct Diagnostic {
  code : Code
  stage : Stage
  message : String
  start : Int32
  end : Int32
  exclusion : Exclusion?
  profile : String?
  help : String?
}

///|
pub fn Diagnostic::new(
  code : Code,
  stage : Stage,
  message : String,
  start : Int32,
  end : Int32,
  exclusion? : Exclusion,
  profile? : String,
  help? : String,
) -> Diagnostic {
  { code, stage, message, start, end, exclusion, profile, help, }
}

///|
/// Exit statuses of the command line, one per kind of outcome.
pub let exit_ok : Int32 = 0

///|
pub let exit_by_design : Int32 = 1

///|
pub let exit_omitted : Int32 = 2

///|
pub let exit_ill_formed : Int32 = 3

///|
pub let exit_syntax : Int32 = 4

///|
pub let exit_undefined : Int32 = 5

///|
pub let exit_terminated : Int32 = 6

///|
pub fn Diagnostic::exit_code(self : Diagnostic) -> Int32 {
  match self.exclusion {
    Some(ByDesign) => exit_by_design
    Some(Omitted) => exit_omitted
    None => if self.stage is Parse { exit_syntax } else { exit_ill_formed }
  }
}

///|
/// The exit status of a list of diagnostics: the first one's, or ok.
pub fn exit_code_of(diagnostics : ArrayView[Diagnostic]) -> Int32 {
  match diagnostics {
    [] => exit_ok
    [first, ..] => first.exit_code()
  }
}

///|
/// The message of a form pure-js leaves out.
pub fn exclusion_message(f : @tables.Feature) -> String {
  match f.status() {
    ByDesign =>
      "pure-js leaves out \{f.what()} by design: \{f.why().unwrap_or("")}"
    _ => {
      let profile = match f.profile() {
        Some(p) => "; the \{p} profile will admit them"
        None => ""
      }
      "this version of pure-js leaves out \{f.what()}\{profile}"
    }
  }
}

///|
/// A diagnostic for a form pure-js leaves out.
pub fn excluded(
  f : @tables.Feature,
  stage : Stage,
  start : Int32,
  end : Int32,
) -> Diagnostic {
  let exclusion = match f.status() {
    ByDesign => Some(ByDesign)
    Omitted => Some(Omitted)
    Core => None
  }
  {
    code: Feature(f),
    stage,
    message: exclusion_message(f),
    start,
    end,
    exclusion,
    profile: f.profile(),
    help: None,
  }
}

///|
/// 1-based line and column of an offset.
pub fn line_column(source : String, offset : Int32) -> (Int32, Int32) {
  let mut line = 1
  let mut line_start = 0
  for i in 0..<offset.min(source.length()) {
    if source[i] == '\n' {
      line += 1
      line_start = i + 1
    }
  }
  (line, offset - line_start + 1)
}

///|
/// Raised inside a stage to stop at its first problem (the parser stops there).
pub(all) suberror Stop {
  Stop(Diagnostic)
}

///|
/// A syntax error at start..end.
pub fn syntax_error(message : String, start : Int32, end? : Int32) -> Stop {
  Stop(
    Diagnostic::new(
      SyntaxError,
      Parse,
      message,
      start,
      end.unwrap_or(start + 1),
    ),
  )
}

///|
/// A form the parser recognizes and pure-js leaves out.
pub fn excluded_at(f : @tables.Feature, start : Int32, end : Int32) -> Stop {
  Stop(excluded(f, Parse, start, end))
}
