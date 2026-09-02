import { isPlainObject } from "./collection.js";
import { COMPONENT, Component } from "./components.js";
import { freeze, immerable } from "./immer.js";

const BAD_VALUE = Symbol("BadValue");

// A coercer turns an invalid value into a valid one, or null to give up.
const COERCE_NONE = (_v) => null;
const COERCE_MAP = (v) => {
  if (v instanceof Map) return new Map(v);
  if (Array.isArray(v) || isPlainObject(v))
    return new Map(Array.isArray(v) ? v : Object.entries(v));
  return null;
};
// The field types by name: [typeCheck, coercer, makeDefault]. A type check is a
// plain predicate; the default is made per field so no two fields share a Map.
const FIELD_TYPES = {
  any: [(_v) => true, COERCE_NONE, () => null],
  text: [(v) => typeof v === "string", (v) => v?.toString?.() ?? "", () => ""],
  int: [Number.isInteger, (v) => (Number.isFinite(v) ? Math.trunc(v) : null), () => 0],
  float: [Number.isFinite, COERCE_NONE, () => 0],
  bool: [(v) => typeof v === "boolean", (v) => !!v, () => false],
  list: [Array.isArray, (v) => (Array.isArray(v) ? [...v] : null), () => []],
  object: [isPlainObject, (v) => (isPlainObject(v) ? { ...v } : null), () => ({})],
  map: [(v) => v instanceof Map, COERCE_MAP, () => new Map()],
  set: [
    (v) => v instanceof Set,
    (v) => (v instanceof Set || Array.isArray(v) ? new Set(v) : null),
    () => new Set(),
  ],
};

export class Field {
  // `type` names an entry of FIELD_TYPES; `defaultValue` falls back to the type's own.
  constructor(type, name, defaultValue, [typeCheck, coercer, makeDefault] = FIELD_TYPES[type]) {
    this.type = type;
    this.name = name;
    this.typeCheck = typeCheck;
    this.coercer = coercer;
    this.defaultValue = defaultValue === undefined ? makeDefault() : defaultValue;
  }
  isValid(v) {
    return this.typeCheck(v);
  }
  coerceOr(v, defaultValue = null) {
    if (this.isValid(v)) return v;
    const v1 = this.coercer(v);
    return this.isValid(v1) ? v1 : defaultValue;
  }
  coerceOrDefault(v) {
    return this.coerceOr(v, this.defaultValue);
  }
}

// The component metadata record: `component()` classes carry it behind COMPONENT,
// classFromData() classes behind getMetaClass().
const metaOf = (v) => v?.constructor?.[COMPONENT] ?? v?.constructor?.getMetaClass?.();
const getTypeName = (v) => metaOf(v)?.name ?? null;
// A component-typed field: `type` is a component NAME, resolved through the scope
// when an instance is made (see mkCompField); a value is valid when it is one.
class FieldComp extends Field {
  constructor(type, name, args) {
    super(type, name, null, [(v) => getTypeName(v) === type, COERCE_NONE, () => null]);
    this.args = args;
  }
}

function mkCompField(field, scope, args) {
  const Comp = scope?.lookupComponent(field.type) ?? null;
  if (Comp === null)
    console.warn(
      scope
        ? `component field "${field.name}": component "${field.type}" not found in scope`
        : `component field "${field.name}": cannot resolve component "${field.type}" — built without a registered scope (use ${field.type}.make({}) as the default, or build via a registered component)`,
    );
  return Comp?.make({ ...field.args, ...args }, { scope }) ?? null;
}

// The field a `fields:` entry declares. The type is inferred from the default
// value's JS type; the descriptor form `{ type, defaultValue }` names it, and
// `{ component, args }` declares a component-typed field by component name.
function fieldFromSpec(name, value) {
  const type = typeof value;
  if (type === "string") return new Field("text", name, value);
  // Every numeric default is a float: a JS number literal can't express
  // int-ness (`0.0` IS `0`), so inferring `int` from a whole number silently
  // truncates every later assignment. `int` is opt-in, via the descriptor
  // form `{ type: "int", defaultValue: 0 }`.
  if (type === "number") return new Field("float", name, value);
  if (type === "boolean") return new Field("bool", name, value);
  if (Array.isArray(value)) return new Field("list", name, [...value]);
  if (value instanceof Set) return new Field("set", name, new Set(value));
  if (value instanceof Map) return new Field("map", name, new Map(value));
  if (value?.type && Object.hasOwn(value, "defaultValue")) {
    const t = value.type in FIELD_TYPES ? value.type : "any";
    const probe = new Field(t, name);
    return new Field(t, name, probe.coerceOr(value.defaultValue, probe.defaultValue));
  }
  if (value?.component && value?.args !== undefined)
    return new FieldComp(value.component, name, value.args);
  if (isPlainObject(value)) return new Field("object", name, { ...value });
  return new Field("any", name, value);
}

export function classFromData(name, { fields: spec = {}, methods = {}, statics = {} }) {
  const fields = {};
  for (const key in spec) fields[key] = fieldFromSpec(key, spec[key]);
  const defaults = Object.fromEntries(
    Object.entries(fields).map(([key, field]) => [key, field.defaultValue]),
  );
  const Class = {
    [name]: class {
      constructor(values = {}) {
        Object.assign(this, defaults, values);
      }
    },
  }[name];
  Class[immerable] = true;
  Object.assign(Class.prototype, methods);
  const metaClass = { fields, name, methods };
  Object.assign(
    Class,
    {
      getMetaClass: () => metaClass,
      make(inArgs = {}, opts = {}) {
        const args = {};
        // The metadata record's scope (set at registration) is authoritative;
        // a manually-assigned static `.scope` stays as a fallback.
        const scope = opts.scope ?? this[COMPONENT]?.scope ?? this.scope;
        for (const key in inArgs) {
          const field = fields[key];
          if (field === undefined)
            console.warn("extra argument to constructor:", name, key, inArgs);
          else if (field instanceof FieldComp) args[key] = mkCompField(field, scope, inArgs[key]);
          else args[key] = field.coerceOrDefault(inArgs[key]);
        }
        // A component field left out still gets an instance, built through the scope.
        for (const key in fields)
          if (fields[key] instanceof FieldComp && args[key] === undefined)
            args[key] = mkCompField(fields[key], scope, undefined);
        return freeze(new this(args), true);
      },
    },
    statics,
  );
  return Class;
}

// Coerce direct draft assignments with the same policy used by Class.make(). A failed
// assignment is reverted, matching the old generated setter's warn-and-no-op behavior.
export function validateDraftFields(current, draft) {
  const meta = metaOf(current);
  if (!meta) return;
  for (const [name, field] of Object.entries(meta.fields)) {
    const value = draft[name];
    if (field.isValid(value)) continue;
    const coerced = field.coerceOr(value, BAD_VALUE);
    if (coerced !== BAD_VALUE) draft[name] = coerced;
    else {
      console.warn(`invalid value for ${meta.name}.${name}`, value);
      draft[name] = current[name];
    }
  }
}

// Unification: the generated Class IS the component. `component()` returns the
// Class, carrying its metadata record (`Component` instance) behind COMPONENT.
// The record is the single source of truth: `fields`/`methods` are folded into
// it and `getMetaClass()` is redefined to return the record itself.
const META_KEYS =
  "name id fields methods views receive intent alter provide provideType lookup spec extra commonStyle globalStyle scope _rawProvide _rawLookup".split(
    " ",
  );
const RESERVED_COMPONENT_STATICS = new Set([
  ...META_KEYS,
  "make",
  "getMetaClass",
  ...Object.getOwnPropertyNames(Component.prototype),
]);

function assertNoReservedComponentStatics(statics = {}) {
  for (const name in statics) {
    if (RESERVED_COMPONENT_STATICS.has(name)) {
      throw new TypeError(`component static "${name}" is reserved by the framework`);
    }
  }
}

Component.fromSpec = (opts) => {
  assertNoReservedComponentStatics(opts.statics);
  const Class = classFromData(opts.name, opts);
  const comp = new Component(Class, opts);
  // Fold the builder's { fields, name, methods } view into the meta record...
  const metaClass = Class.getMetaClass();
  comp.fields = metaClass.fields;
  comp.methods = metaClass.methods;
  // ...and make `getMetaClass()` hand back the record (a superset: it also
  // carries name/views/handlers/spec). Instance code keeping the documented
  // `this.constructor.getMetaClass().fields.x.defaultValue` pattern works
  // unchanged.
  Class.getMetaClass = () => comp;
  Class[COMPONENT] = comp;
  // Expose the metadata buckets as static accessors so direct reads
  // (`Counter.receive.inc`, `Comp.spec`, `Widget.scope`) keep working, with
  // write-through (`Comp.scope = ...`) matching the old record's mutability.
  // Reserved-name validation above guarantees these accessors cannot be shadowed
  // by a user static.
  for (const key of META_KEYS)
    if (!Object.hasOwn(Class, key))
      Object.defineProperty(Class, key, {
        get() {
          return comp[key];
        },
        set(v) {
          comp[key] = v;
        },
        configurable: true,
      });
  // Forward the metadata record's behavior (compile/getView/compileStyle/...)
  // onto the Class, skipping names the generated class already owns.
  for (const key of Object.getOwnPropertyNames(Component.prototype))
    if (key !== "constructor" && !Object.hasOwn(Class, key))
      Class[key] = (...args) => comp[key](...args);
  return Class;
};
export const component = (opts) => Component.fromSpec(opts);
