import { isPlainObject } from "./collection.js";
import { COMPONENT, Component } from "./components.js";
import { freeze, immerable } from "./immer.js";

const BAD_VALUE = Symbol("BadValue");
const nullCoercer = (v) => v;

export class Field {
  constructor(type, name, typeCheck, coercer, defaultValue = null) {
    this.type = type;
    this.name = name;
    this.typeCheck = typeCheck;
    this.coercer = coercer;
    this.defaultValue = defaultValue;
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

// A type check is a plain predicate.
const CHECK_TYPE_ANY = (_v) => true;
const CHECK_TYPE_INT = Number.isInteger;
const CHECK_TYPE_FLOAT = Number.isFinite;
const CHECK_TYPE_BOOL = (v) => typeof v === "boolean";
const CHECK_TYPE_STRING = (v) => typeof v === "string";
const CHECK_TYPE_LIST = Array.isArray;
const CHECK_TYPE_OBJECT = isPlainObject;
const CHECK_TYPE_MAP = (v) => v instanceof Map;
const CHECK_TYPE_SET = (v) => v instanceof Set;

// A coercer turns an invalid value into a valid one, or null to give up.
const COERCE_NONE = (_v) => null;
const COERCE_BOOL = (v) => !!v;
const COERCE_STRING = (v) => v?.toString?.() ?? "";
const COERCE_INT = (v) => (Number.isFinite(v) ? Math.trunc(v) : null);
const COERCE_LIST = (v) => (Array.isArray(v) ? [...v] : null);
const COERCE_OBJECT = (v) => (isPlainObject(v) ? { ...v } : null);
const COERCE_MAP = (v) => {
  if (v instanceof Map) return new Map(v);
  if (Array.isArray(v) || isPlainObject(v))
    return new Map(Array.isArray(v) ? v : Object.entries(v));
  return null;
};
const COERCE_SET = (v) => (v instanceof Set || Array.isArray(v) ? new Set(v) : null);

export class FieldBool extends Field {
  constructor(name, defaultValue = false) {
    super("bool", name, CHECK_TYPE_BOOL, COERCE_BOOL, defaultValue);
  }
}
class FieldAny extends Field {
  constructor(name, defaultValue = null) {
    super("any", name, CHECK_TYPE_ANY, nullCoercer, defaultValue);
  }
}
export class FieldString extends Field {
  constructor(name, defaultValue = "") {
    super("text", name, CHECK_TYPE_STRING, COERCE_STRING, defaultValue);
  }
}
export class FieldInt extends Field {
  constructor(name, defaultValue = 0) {
    super("int", name, CHECK_TYPE_INT, COERCE_INT, defaultValue);
  }
}
export class FieldFloat extends Field {
  constructor(name, defaultValue = 0) {
    super("float", name, CHECK_TYPE_FLOAT, COERCE_NONE, defaultValue);
  }
}

// The component metadata record: `component()` classes carry it behind COMPONENT,
// classFromData() classes behind getMetaClass().
const metaOf = (v) => v?.constructor?.[COMPONENT] ?? v?.constructor?.getMetaClass?.();
export const getTypeName = (v) => metaOf(v)?.name ?? null;
export class FieldComp extends Field {
  constructor(type, name, args) {
    super(type, name, (v) => getTypeName(v) === type, nullCoercer, null);
    this.args = args;
  }
}

export class FieldList extends Field {
  constructor(name, defaultValue = []) {
    super("list", name, CHECK_TYPE_LIST, COERCE_LIST, defaultValue);
  }
}
export class FieldObject extends Field {
  constructor(name, defaultValue = {}) {
    super("object", name, CHECK_TYPE_OBJECT, COERCE_OBJECT, defaultValue);
  }
}
export class FieldMap extends Field {
  constructor(name, defaultValue = new Map()) {
    super("map", name, CHECK_TYPE_MAP, COERCE_MAP, defaultValue);
  }
}
export class FieldSet extends Field {
  constructor(name, defaultValue = new Set()) {
    super("set", name, CHECK_TYPE_SET, COERCE_SET, defaultValue);
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

class ClassBuilder {
  constructor(name) {
    this.name = name;
    this.fields = {};
    this.compFields = new Set();
    this._methods = {};
    this._statics = {};
  }
  build() {
    const { name, fields, compFields, _methods } = this;
    const defaults = Object.fromEntries(
      Object.entries(fields).map(([fieldName, field]) => [fieldName, field.defaultValue]),
    );
    const Class = {
      [name]: class {
        constructor(values = {}) {
          Object.assign(this, defaults, values);
        }
      },
    }[name];
    Class[immerable] = true;
    Object.assign(Class.prototype, _methods);
    const metaClass = { fields, name, methods: _methods };
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
            if (compFields.has(key)) args[key] = mkCompField(field, scope, inArgs[key]);
            else if (field === undefined)
              console.warn("extra argument to constructor:", name, key, inArgs);
            else args[key] = field.coerceOrDefault(inArgs[key]);
          }
          for (const key of compFields)
            if (args[key] === undefined) args[key] = mkCompField(fields[key], scope, inArgs[key]);
          return freeze(new this(args), true);
        },
      },
      this._statics,
    );
    return Class;
  }
  methods(proto) {
    for (const k in proto) this._methods[k] = proto[k];
  }
  statics(proto) {
    for (const k in proto) this._statics[k] = proto[k];
  }
  addField(name, dval, FieldCls) {
    const field = new FieldCls(name, dval);
    this.fields[name] = field;
    return field;
  }
  addCompField(name, type, args) {
    const field = new FieldComp(type, name, args);
    this.compFields.add(name);
    this.fields[name] = field;
    return field;
  }
}

export const FIELD_CLASS = Symbol.for("tutuca.fieldClass");
const fieldsByTypeName = {
  text: FieldString,
  int: FieldInt,
  float: FieldFloat,
  bool: FieldBool,
  list: FieldList,
  object: FieldObject,
  map: FieldMap,
  set: FieldSet,
  any: FieldAny,
};

function fieldFromDescriptor(name, value) {
  const FieldCls = fieldsByTypeName[value.type] ?? FieldAny;
  const probe = new FieldCls(name);
  return [FieldCls, probe.coerceOr(value.defaultValue, probe.defaultValue)];
}

export function classFromData(name, { fields = {}, methods, statics }) {
  const b = new ClassBuilder(name);
  for (const field in fields) {
    const value = fields[field];
    const type = typeof value;
    if (type === "string") b.addField(field, value, FieldString);
    else if (type === "number")
      b.addField(field, value, Number.isInteger(value) ? FieldInt : FieldFloat);
    else if (type === "boolean") b.addField(field, value, FieldBool);
    else if (Array.isArray(value)) b.addField(field, [...value], FieldList);
    else if (value instanceof Set) b.addField(field, new Set(value), FieldSet);
    else if (value instanceof Map) b.addField(field, new Map(value), FieldMap);
    else if (value?.type && Object.hasOwn(value, "defaultValue")) {
      const [FieldCls, dval] = fieldFromDescriptor(field, value);
      b.addField(field, dval, FieldCls);
    } else if (value?.component && value?.args !== undefined)
      b.addCompField(field, value.component, value.args);
    else if (isPlainObject(value)) b.addField(field, { ...value }, FieldObject);
    else {
      const FieldCls = value?.[FIELD_CLASS] ?? FieldAny;
      b.addField(field, value, FieldCls);
    }
  }
  if (methods) b.methods(methods);
  if (statics) b.statics(statics);
  return b.build();
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
