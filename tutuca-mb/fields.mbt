// What a component says about its state and messages, for the dev tools: MoonBit's types
// replace JS's field schemas (`t.*`) and message specs, so a component can describe them here.
// Nothing at runtime reads these; the dev panel shows them.

///|
/// A field's type, in the words JS's field schemas have.
pub(all) enum FieldType {
  Text
  Boolean
  Number
  Whole
  OneOf(Array[Json])
  ListOf(FieldType)
  MapOf(FieldType)
  RecordOf(Array[(String, FieldType)])
  Either(Array[FieldType])
  KeyOf(String) // A key of another field's collection.
  ComponentOf(Array[String]) // A state of one of these components.
  Optional(FieldType)
  Anything
} derive(Eq, Debug, ToJson)

///|
/// What a field's values must also be.
pub(all) enum Constraint {
  AtLeast(Double)
  AtMost(Double)
  MinLength(Int32)
  MaxLength(Int32)
  Matching(String)
  Where(String) // A named predicate holds: an invariant or a check of the field.
} derive(Eq, Debug, ToJson)

///|
/// A field of a component's state: its name, type, constraints and the value it starts with.
pub(all) struct FieldInfo {
  name : String
  ty : FieldType
  constraints : Array[Constraint]
  initial : Json?
  /// Whether it starts with a value computed when the state is made (JS's default function).
  computed_initial : Bool
  checks : Array[String] // The component's invariants that check these constraints.
} derive(Eq, Debug, ToJson)

///|
pub fn field_info(
  name : String,
  ty : FieldType,
  constraints~ : Array[Constraint] = [],
  initial? : Json,
  computed_initial~ : Bool = false,
  checks~ : Array[String] = [],
) -> FieldInfo {
  { name, ty, constraints, initial, computed_initial, checks, }
}
