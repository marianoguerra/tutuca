export function componentDataFromJson(o) {
  const {
    name = "UnkComp",
    fields = {},
    view = "...",
    views = {},
    style = "",
    dynamic = {},
    on = {},
  } = o;
  const methods = parseFnObj(o.methods ?? {});
  const statics = parseFnObj(o.statics ?? {});
  const computed = parseFnObj(o.computed ?? {});
  const input = parseFnObj(o.input ?? {});
  const logic = parseFnObj(o.logic ?? {});
  const bubble = parseFnObj(o.bubble ?? {});
  const response = parseFnObj(o.response ?? {});
  const alter = parseFnObj(o.alter ?? {});
  return {
    name,
    fields,
    methods,
    statics,
    view,
    views,
    style,
    computed,
    input,
    logic,
    bubble,
    response,
    alter,
    dynamic,
    on,
  };
}

export function macroToJson(name, m) {
  return { name, args: m.defaults, view: m.rawView };
}

export function componentToJson(Comp) {
  const { name, fields, methods } = Comp.Class.getMetaClass();
  const computed = fnObjToData(Comp.computed);
  const input = fnObjToData(Comp.input);
  const logic = fnObjToData(Comp.logic);
  const bubble = fnObjToData(Comp.bubble);
  const response = fnObjToData(Comp.response);
  const alter = fnObjToData(Comp.alter);
  const dynamic = dynamicsToData(Comp.dynamic);
  const views = {};
  for (const key in Comp.views) {
    const { style = "", rawView = "" } = Comp.views[key] ?? {};
    views[key] = style ? { style, view: rawView } : rawView;
  }
  const { style = "", rawView = "" } = Comp.views.main ?? {};
  delete views.main;
  const data = {
    name,
    fields: toFieldsJson(fields),
    methods: fnObjToData(methods),
    //statics,
    views: undefinedIfEmptyObj(views),
    style: style || undefined,
    view: rawView,
    computed,
    input,
    logic,
    bubble,
    response,
    alter,
    dynamic,
    on: fnObjToData(Comp.on),
  };
  return data;
}

function undefinedIfEmptyObj(o) {
  for (const _key in o) {
    return o;
  }
  return undefined;
}

function parseFnObj(obj) {
  const r = {};
  for (const key in obj) {
    const { args = [], body = "return this;" } = obj[key];
    r[key] = new Function(...args, body);
  }
  return r;
}

function fnObjToData(obj) {
  const r = {};
  for (const key in obj) {
    const fn = obj[key];
    const s = fn.toString();
    const body = s.slice(s.indexOf("{") + 1, s.lastIndexOf("}")).trim();
    const args = s
      .slice(s.indexOf("(") + 1, s.indexOf(")"))
      .trim()
      .split(/\s*,\s*/)
      .filter((v) => v !== "");
    r[key] = args.length > 0 ? { args, body } : { body };
  }
  return undefinedIfEmptyObj(r);
}

function toFieldsJson(fields) {
  const r = {};
  for (const key in fields) {
    const field = fields[key];
    r[key] = field.toDataDef();
  }
  return undefinedIfEmptyObj(r);
}

export function dynamicsToData(dyns) {
  const r = {};
  for (const name in dyns) {
    r[name] = dynamicToData(dyns[name]);
  }
  return r;
}

export function dynamicToData(dyn) {
  if (dyn.compName) {
    const { compName, dynName, val } = dyn;
    return { for: `${compName}.${dynName}`, default: valToString(val) };
  } else {
    return valToString(dyn.val);
  }
}

export function valToString(v) {
  switch (v.constructor.name) {
    case "RawFieldVal":
    case "FieldVal":
      return `.${v.name}`;
    case "DynVal":
      return `^${v.name}`;
    case "ComputedVal":
      return `$${v.name}`;
    case "BindVal":
      return `@${v.name}`;
    case "RequestVal":
      return `!${v.name}`;
    case "NameVal":
    case "TypeVal":
      return v.name;
    default:
      console.warn("unknown val type", v);
      return null;
  }
}
