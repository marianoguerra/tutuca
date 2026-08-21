import { Component } from "./components.js";
import { freeze, immerable } from "./immer.js";

const BAD_VALUE = Symbol("BadValue");
const nullCoercer = (v) => v;
const isPlainObject = (v) => {
  if (v === null || typeof v !== "object") return false;
  const proto = Object.getPrototypeOf(v);
  return proto === Object.prototype || proto === null;
};

function defaultToData(v) {
  if (v instanceof Map) return [...v.entries()];
  if (v instanceof Set) return [...v.values()];
  return v;
}

export class Field {
  constructor(type, name, typeCheck, coercer, defaultValue = null) {
    this.type = type;
    this.name = name;
    this.typeCheck = typeCheck;
    this.coercer = coercer;
    this.checks = [];
    this.defaultValue = defaultValue;
  }
  toDataDef() {
    return { type: this.type, defaultValue: defaultToData(this.defaultValue) };
  }
  getFirstFailingCheck(v) {
    if (!this.typeCheck.isValid(v)) return this.typeCheck;
    for (const check of this.checks) if (!check.isValid(v)) return check;
    return null;
  }
  isValid(v) {
    return this.getFirstFailingCheck(v) === null;
  }
  addCheck(check) {
    this.checks.push(check);
    return this;
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

class Check {
  isValid(_v) {
    return true;
  }
  getMessage(_v) {
    return "Invalid";
  }
}
class CheckTypeAny extends Check {}
const CHECK_TYPE_ANY = new CheckTypeAny();
class FnCheck extends Check {
  constructor(isValidFn, getMessageFn) {
    super();
    this._isValid = isValidFn;
    this._getMessage = getMessageFn;
  }
  isValid(v) {
    return this._isValid(v);
  }
  getMessage(v) {
    return this._getMessage(v);
  }
}
const check = (fn, message) => new FnCheck(fn, () => message);
const CHECK_TYPE_INT = check(Number.isInteger, "Integer expected");
const CHECK_TYPE_FLOAT = check(Number.isFinite, "Float expected");
const CHECK_TYPE_BOOL = check((v) => typeof v === "boolean", "Boolean expected");
const CHECK_TYPE_STRING = check((v) => typeof v === "string", "String expected");
const CHECK_TYPE_LIST = check(Array.isArray, "Array expected");
const CHECK_TYPE_OBJECT = check(isPlainObject, "Plain object expected");
const CHECK_TYPE_MAP = check((v) => v instanceof Map, "Map expected");
const CHECK_TYPE_SET = check((v) => v instanceof Set, "Set expected");

export class FieldBool extends Field {
  constructor(name, defaultValue = false) {
    super("bool", name, CHECK_TYPE_BOOL, (v) => !!v, defaultValue);
  }
}
export class FieldAny extends Field {
  constructor(name, defaultValue = null) {
    super("any", name, CHECK_TYPE_ANY, nullCoercer, defaultValue);
  }
  toDataDef() {
    return { type: getTypeName(this.defaultValue) ?? "any", defaultValue: this.defaultValue };
  }
}
export class FieldString extends Field {
  constructor(name, defaultValue = "") {
    super("text", name, CHECK_TYPE_STRING, (v) => v?.toString?.() ?? "", defaultValue);
  }
}
export class FieldInt extends Field {
  constructor(name, defaultValue = 0) {
    super(
      "int",
      name,
      CHECK_TYPE_INT,
      (v) => (Number.isFinite(v) ? Math.trunc(v) : null),
      defaultValue,
    );
  }
}
export class FieldFloat extends Field {
  constructor(name, defaultValue = 0) {
    super("float", name, CHECK_TYPE_FLOAT, (_) => null, defaultValue);
  }
}

export const getTypeName = (v) => v?.constructor?.getMetaClass?.()?.name;
class CheckTypeName {
  constructor(typeName) {
    this.typeName = typeName;
  }
  isValid(v) {
    return getTypeName(v) === this.typeName;
  }
  getMessage(v) {
    return `Expected "${this.typeName}", got "${getTypeName(v)}"`;
  }
}
export class FieldComp extends Field {
  constructor(type, name, args) {
    super(type, name, new CheckTypeName(type), nullCoercer, null);
    this.args = args;
  }
  toDataDef() {
    return { component: this.type, args: this.args };
  }
}

export class FieldList extends Field {
  constructor(name, defaultValue = []) {
    super("list", name, CHECK_TYPE_LIST, (v) => (Array.isArray(v) ? [...v] : null), defaultValue);
  }
}
export class FieldObject extends Field {
  constructor(name, defaultValue = {}) {
    super(
      "object",
      name,
      CHECK_TYPE_OBJECT,
      (v) => (isPlainObject(v) ? { ...v } : null),
      defaultValue,
    );
  }
}
export class FieldMap extends Field {
  constructor(name, defaultValue = new Map()) {
    super(
      "map",
      name,
      CHECK_TYPE_MAP,
      (v) => {
        if (v instanceof Map) return new Map(v);
        if (Array.isArray(v) || isPlainObject(v))
          return new Map(Array.isArray(v) ? v : Object.entries(v));
        return null;
      },
      defaultValue,
    );
  }
}
export class FieldSet extends Field {
  constructor(name, defaultValue = new Set()) {
    super(
      "set",
      name,
      CHECK_TYPE_SET,
      (v) => (v instanceof Set || Array.isArray(v) ? new Set(v) : null),
      defaultValue,
    );
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
          const scope = opts.scope ?? this.scope;
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
export const fieldsByTypeName = {
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
  const meta = current?.constructor?.getMetaClass?.();
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

Component.fromSpec = (opts) => new Component(classFromData(opts.name, opts), opts);
export const component = (opts) => Component.fromSpec(opts);
