export function componentDataFromJson(o) {
  const {
    name = "UnkComp",
    fields = {},
    view = "...",
    views = {},
    style = "",
    provide = {},
    lookup = {},
  } = o;
  const methods = parseFnObj(o.methods ?? {});
  const statics = parseFnObj(o.statics ?? {});
  const input = parseFnObj(o.input ?? {});
  const receive = parseFnObj(o.receive ?? {});
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
    input,
    receive,
    bubble,
    response,
    alter,
    provide,
    lookup,
  };
}

export function macroToJson(name, m) {
  return { name, args: m.defaults, view: m.rawView };
}

export function componentToJson(Comp) {
  const { name, fields, methods } = Comp.Class.getMetaClass();
  const input = fnObjToData(Comp.input);
  const receive = fnObjToData(Comp.receive);
  const bubble = fnObjToData(Comp.bubble);
  const response = fnObjToData(Comp.response);
  const alter = fnObjToData(Comp.alter);
  const provide = provideToData(Comp.provide);
  const lookup = lookupToData(Comp.lookup);
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
    input,
    receive,
    bubble,
    response,
    alter,
    provide: undefinedIfEmptyObj(provide),
    lookup: undefinedIfEmptyObj(lookup),
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

export function provideToData(provs) {
  const r = {};
  for (const name in provs) r[name] = String(provs[name].val);
  return r;
}

export function lookupToData(lks) {
  const r = {};
  for (const name in lks) {
    const lk = lks[name];
    const forStr = `${lk.compName}.${lk.provideName}`;
    r[name] = lk.val ? { for: forStr, default: String(lk.val) } : forStr;
  }
  return r;
}
