import { Map as IMap, Set as ISet, List, OrderedMap, Record } from "../deps/immutable.js";
import { Component } from "./components.js";

const BAD_VALUE = Symbol("BadValue");
const nullCoercer = (v) => v;
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
    const { type, defaultValue: dv } = this;
    return { type, defaultValue: dv?.toJS ? dv.toJS() : dv };
  }
  getFirstFailingCheck(v) {
    if (!this.typeCheck.isValid(v)) {
      return this.typeCheck;
    }
    for (const check of this.checks) {
      if (!check.isValid(v)) {
        return check;
      }
    }
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
    if (this.isValid(v)) {
      return v;
    }
    const v1 = this.coercer(v);
    return this.isValid(v1) ? v1 : defaultValue;
  }
  coerceOrDefault(v) {
    return this.coerceOr(v, this.defaultValue);
  }
  extendProtoForType(_proto, _uname) {}
  extendProto(proto) {
    const { name } = this;
    const uname = name[0].toUpperCase() + name.slice(1);
    const setName = `set${uname}`;
    const that = this;
    proto[setName] = function (v) {
      const v1 = that.coerceOr(v, BAD_VALUE);
      if (v1 === BAD_VALUE) {
        console.warn("invalid value", v);
        return this;
      }
      return this.set(name, v1);
    };
    proto[`update${uname}`] = function (fn) {
      return this[setName](fn(this.get(name)));
    };
    proto[`reset${uname}`] = function () {
      return this.set(name, that.defaultValue);
    };
    proto[`is${uname}NotSet`] = function () {
      return this.get(name) == null;
    };
    proto[`is${uname}Set`] = function () {
      return this.get(name) != null;
    };
    this.extendProtoForType(proto, uname);
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
const CHECK_TYPE_INT = new FnCheck(
  (v) => Number.isInteger(v),
  () => "Integer expected",
);
const CHECK_TYPE_FLOAT = new FnCheck(
  (v) => Number.isFinite(v),
  () => "Float expected",
);
const CHECK_TYPE_BOOL = new FnCheck(
  (v) => typeof v === "boolean",
  () => "Boolean expected",
);
const CHECK_TYPE_STRING = new FnCheck(
  (v) => typeof v === "string",
  () => "String expected",
);
const CHECK_TYPE_LIST = new FnCheck(
  (v) => List.isList(v),
  () => "List expected",
);
const CHECK_TYPE_MAP = new FnCheck(
  (v) => IMap.isMap(v),
  () => "Map expected",
);
const CHECK_TYPE_OMAP = new FnCheck(
  (v) => OrderedMap.isOrderedMap(v),
  () => "OrderedMap expected",
);
const CHECK_TYPE_SET = new FnCheck(
  (v) => ISet.isSet(v),
  () => "Set expected",
);
const boolCoercer = (v) => !!v;
export class FieldBool extends Field {
  constructor(name, defaultValue = false) {
    super("bool", name, CHECK_TYPE_BOOL, boolCoercer, defaultValue);
  }
  extendProtoForType(proto, uname) {
    const { name } = this;
    proto[`toggle${uname}`] = function () {
      return this.set(name, !this.get(name, false));
    };
    proto[`set${uname}`] = function (v) {
      return this.set(name, !!v);
    };
  }
}
export class FieldAny extends Field {
  constructor(name, defaultValue = null) {
    super("any", name, CHECK_TYPE_ANY, nullCoercer, defaultValue);
  }
  toDataDef() {
    const { defaultValue: dv } = this;
    const type = getTypeName(dv) ?? "any";
    return { type, defaultValue: dv?.toJS ? dv.toJS() : dv };
  }
}
const stringCoercer = (v) => v?.toString?.() ?? "";
export class FieldString extends Field {
  constructor(name, defaultValue = "") {
    super("text", name, CHECK_TYPE_STRING, stringCoercer, defaultValue);
  }
  extendProtoForType(proto, _uname) {
    const { name } = this;
    proto[`${name}IsEmpty`] = function () {
      return this.get(name, "").length === 0;
    };
    proto[`${name}Len`] = function () {
      return this.get(name, "").length;
    };
  }
}
const intCoercer = (v) => (Number.isFinite(v) ? Math.trunc(v) : null);
export class FieldInt extends Field {
  constructor(name, defaultValue = 0) {
    super("int", name, CHECK_TYPE_INT, intCoercer, defaultValue);
  }
}
const floatCoercer = (_) => null;
export class FieldFloat extends Field {
  constructor(name, defaultValue = 0) {
    super("float", name, CHECK_TYPE_FLOAT, floatCoercer, defaultValue);
  }
}
export const getTypeName = (v) => v?.constructor?.getMetaClass?.()?.name;
class CheckTypeName {
  constructor(typeName) {
    this.typeName = typeName; // TODO: cache instances by name
  }
  isValid(v) {
    return getTypeName(v) === this.typeName; // NOTE: same type name in diff scope will return true
  }
  getMessage(v) {
    const got = getTypeName(v);
    return `Expected "${this.typeName}", got "${got}"`;
  }
}
export class FieldComp extends Field {
  constructor(type, name, args) {
    super(type, name, new CheckTypeName(type), nullCoercer, null);
    this.args = args;
  }
  toDataDef() {
    return { component: this.typeName, args: this.args };
  }
}
const NONE = Symbol("NONE");
export function extendProtoForKeyed(proto, name, uname) {
  extendProtoSeq(proto, name, EMPTY_LIST);
  proto[`setIn${uname}At`] = function (i, v) {
    return this.set(name, this.get(name).set(i, v));
  };
  proto[`getIn${uname}At`] = function (i, dval) {
    return this.get(name).get(i, dval);
  };
  proto[`updateIn${uname}At`] = function (i, fn) {
    const col = this.get(name);
    const v = col.get(i, NONE);
    if (v !== NONE) {
      return this.set(name, col.set(i, fn(v)));
    }
    console.warn("key", i, "not found in", name, col);
    return this;
  };
  function deleteInAt(i) {
    return this.set(name, this.get(name).delete(i));
  }
  proto[`deleteIn${uname}At`] = deleteInAt;
  proto[`removeIn${uname}At`] = deleteInAt;
}
const EMPTY_LIST = List();
const listCoercer = (v) => (Array.isArray(v) ? List(v) : null);
export class FieldList extends Field {
  constructor(name, defaultValue = EMPTY_LIST) {
    super("list", name, CHECK_TYPE_LIST, listCoercer, defaultValue);
  }
  extendProtoForType(proto, uname) {
    const { name } = this;
    extendProtoForKeyed(proto, name, uname);
    proto[`pushIn${uname}`] = function (v) {
      return this.set(name, this.get(name).push(v));
    };
    proto[`insertIn${uname}At`] = function (i, v) {
      return this.set(name, this.get(name).insert(i, v));
    };
  }
}
const imapCoercer = (v) => IMap(v);
export class FieldMap extends Field {
  constructor(name, defaultValue = IMap()) {
    super("map", name, CHECK_TYPE_MAP, imapCoercer, defaultValue);
  }
  extendProtoForType(proto, uname) {
    extendProtoForKeyed(proto, this.name, uname);
  }
}
const omapCoercer = (v) => OrderedMap(v);
export class FieldOMap extends Field {
  constructor(name, defaultValue = OrderedMap()) {
    super("omap", name, CHECK_TYPE_OMAP, omapCoercer, defaultValue);
  }
  extendProtoForType(proto, uname) {
    extendProtoForKeyed(proto, this.name, uname);
  }
}
function extendProtoSeq(proto, name, defaultEmpty) {
  proto[`${name}IsEmpty`] = function () {
    return this.get(name, defaultEmpty).size === 0;
  };
  proto[`${name}Len`] = function () {
    return this.get(name, defaultEmpty).size;
  };
}
const EMPTY_SET = ISet();
const isetCoercer = (v) => (Array.isArray(v) ? ISet(v) : v instanceof Set ? ISet(v) : null);
export class FieldSet extends Field {
  constructor(name, defaultValue = EMPTY_SET) {
    super("set", name, CHECK_TYPE_SET, isetCoercer, defaultValue);
  }
  extendProtoForType(proto, uname) {
    const { name } = this;
    extendProtoSeq(proto, name, EMPTY_SET);
    proto[`addIn${uname}`] = function (v) {
      return this.set(name, this.get(name).add(v));
    };
    proto[`deleteIn${uname}`] = function (v) {
      return this.set(name, this.get(name).delete(v));
    };
    proto[`removeIn${uname}`] = proto[`deleteIn${uname}`];
    proto[`hasIn${uname}`] = function (v) {
      return this.get(name).has(v);
    };
    proto[`toggleIn${uname}`] = function (v) {
      const current = this.get(name);
      return this.set(name, current.has(v) ? current.delete(v) : current.add(v));
    };
  }
}
function mkCompField(field, scope, args) {
  const Comp = scope.lookupComponent(field.type);
  console.assert(Comp !== null, "component not found", { field });
  return Comp?.make({ ...field.args, ...args }, { scope }) ?? null;
}
class ClassBuilder {
  constructor(name) {
    const fields = {};
    const compFields = new Set();
    this.name = name;
    this.fields = fields;
    this.compFields = compFields;
    this._methods = {};
    this._statics = {
      make: function (inArgs = {}, opts = {}) {
        const args = {};
        for (const key in inArgs) {
          const field = fields[key];
          if (compFields.has(key)) {
            args[key] = mkCompField(field, opts.scope, inArgs[key]);
          } else if (field === undefined) {
            console.warn("extra argument to constructor:", name, key, inArgs);
            continue;
          }
          args[key] = field.coerceOrDefault(inArgs[key]);
        }
        for (const key of compFields) {
          if (args[key] === undefined) {
            args[key] = mkCompField(fields[key], opts.scope, inArgs[key]);
          }
        }
        return this(args);
      },
    };
  }
  build() {
    const fieldVals = {};
    const proto = {};
    const { name, _methods, fields } = this;
    for (const fieldName in fields) {
      const field = fields[fieldName];
      fieldVals[fieldName] = field.defaultValue;
      field.extendProto(proto);
    }
    const Class = { [name]: Record(fieldVals, name) }[name];
    Object.assign(Class.prototype, proto, _methods);
    const metaClass = { fields, name, methods: _methods };
    Object.assign(Class, this._statics, { getMetaClass: () => metaClass });
    return Class;
  }
  methods(proto) {
    return this._mergeProto(this._methods, proto, "method");
  }
  statics(proto) {
    return this._mergeProto(this._statics, proto, "static");
  }
  _mergeProto(target, proto, _name) {
    for (const k in proto) {
      target[k] = proto[k];
    }
    return this;
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
export const fieldsByClass = new Map();
export const fieldsByTypeName = {
  text: FieldString,
  int: FieldInt,
  float: FieldFloat,
  bool: FieldBool,
  list: FieldList,
  map: FieldMap,
  omap: FieldOMap,
  set: FieldSet,
  any: FieldAny,
};
export function classFromData(name, { fields = {}, methods, statics }) {
  const b = new ClassBuilder(name);
  for (const field in fields) {
    const value = fields[field];
    const type = typeof value;
    if (type === "string") {
      b.addField(field, value, FieldString);
    } else if (type === "number") {
      b.addField(field, value, FieldFloat);
    } else if (type === "boolean") {
      b.addField(field, value, FieldBool);
    } else if (List.isList(value) || Array.isArray(value)) {
      b.addField(field, List(value), FieldList);
    } else if (ISet.isSet(value) || value instanceof Set) {
      b.addField(field, ISet(value), FieldSet);
    } else if (OrderedMap.isOrderedMap(value)) {
      b.addField(field, value, FieldOMap);
    } else if (value?.type && value?.defaultValue !== undefined) {
      const Field = fieldsByTypeName[value.type] ?? FieldAny;
      b.addField(field, new Field().coerceOr(value.defaultValue), Field);
    } else if (value?.component && value?.args !== undefined) {
      b.addCompField(field, value.component, value.args);
    } else if (IMap.isMap(value) || value?.constructor === Object) {
      b.addField(field, IMap(value), FieldMap);
    } else {
      const Field = fieldsByClass.get(value?.constructor) ?? FieldAny;
      b.addField(field, value, Field);
    }
  }
  if (methods) {
    b.methods(methods);
  }
  if (statics) {
    b.statics(statics);
  }
  return b.build();
}
export const component = (opts) =>
  new Component(
    opts.name ?? "Comp",
    classFromData(opts.name, opts),
    opts.view ?? "Not Defined",
    opts.views,
    opts.style,
    opts.commonStyle ?? "",
    opts.globalStyle ?? "",
    opts.computed,
    opts.input,
    opts.logic,
    opts.bubble,
    opts.response,
    opts.alter,
    opts.dynamic,
    opts.on,
  );
