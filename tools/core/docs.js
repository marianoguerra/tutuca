import { ComponentDocs } from "./results.js";

function getSignature(name, fn) {
  const s = fn.toString();
  const m = s.match(/^(?:\w+|function\s*\w*)\s*\(([^)]*)\)/);
  const params = m ? m[1].trim() : "";
  return `${name}(${params})`;
}

function serializeDefault(v) {
  if (v === null || v === undefined) return v;
  if (v instanceof Map) return Object.fromEntries(v);
  if (v instanceof Set) return [...v];
  return v;
}

function getComponentDoc(comp) {
  const { fields, name, methods } = comp;

  const userMethods = Object.keys(methods).map((k) => ({
    name: k,
    sig: getSignature(k, methods[k]),
  }));

  const sigs = (bucket) =>
    Object.keys(bucket ?? {}).map((k) => ({ name: k, sig: getSignature(k, bucket[k]) }));
  // The two dispatch buckets. `receive` holds what the component is TOLD — its own view's
  // names, what a parent sends it, and every answer it reads. `intent` holds what it
  // ANSWERS for others.
  const receiveHandlers = sigs(comp.receive);
  const intentHandlers = sigs(comp.intent);

  const fieldDocs = [];
  for (const fieldName in fields) {
    const field = fields[fieldName];
    fieldDocs.push({
      name: fieldName,
      type: field.type,
      default: serializeDefault(field.defaultValue),
      methods: [],
    });
  }

  return {
    name,
    methods: userMethods,
    receive: receiveHandlers,
    intent: intentHandlers,
    fields: fieldDocs,
  };
}

export function docComponents(normalized, { name = null } = {}) {
  const comps = normalized.components;
  const picked = name === null ? comps : comps.filter((c) => c.name === name);
  return new ComponentDocs({ items: picked.map((comp) => getComponentDoc(comp)) });
}
