function getSignature(name, fn) {
  const s = fn.toString();
  const m = s.match(/^(?:\w+|function\s*\w*)\s*\(([^)]*)\)/);
  const params = m ? m[1].trim() : "";
  return `${name}(${params})`;
}

function getFieldMethods(field) {
  const { name, type } = field;
  const uname = name[0].toUpperCase() + name.slice(1);

  const methods = [
    { name: `set${uname}`, sig: `set${uname}(v)`, desc: "Set value" },
    {
      name: `update${uname}`,
      sig: `update${uname}(fn)`,
      desc: "Update value with function",
    },
    {
      name: `reset${uname}`,
      sig: `reset${uname}()`,
      desc: "Reset to default value",
    },
    {
      name: `is${uname}NotSet`,
      sig: `is${uname}NotSet()`,
      desc: "Check if null/undefined",
    },
    {
      name: `is${uname}Set`,
      sig: `is${uname}Set()`,
      desc: "Check if not null/undefined",
    },
  ];

  switch (type) {
    case "bool":
      methods[0].desc = "Set value (coerces to boolean)";
      methods.push({
        name: `toggle${uname}`,
        sig: `toggle${uname}()`,
        desc: "Toggle boolean value",
      });
      break;
    case "text":
      methods.push(
        {
          name: `${name}IsEmpty`,
          sig: `${name}IsEmpty()`,
          desc: "Check if string is empty",
        },
        { name: `${name}Len`, sig: `${name}Len()`, desc: "Get string length" },
      );
      break;
    case "list":
      methods.push(
        {
          name: `${name}IsEmpty`,
          sig: `${name}IsEmpty()`,
          desc: "Check if list is empty",
        },
        { name: `${name}Len`, sig: `${name}Len()`, desc: "Get list size" },
        {
          name: `setIn${uname}At`,
          sig: `setIn${uname}At(i, v)`,
          desc: "Set item at index",
        },
        {
          name: `getIn${uname}At`,
          sig: `getIn${uname}At(i, defaultValue)`,
          desc: "Get item at index",
        },
        {
          name: `updateIn${uname}At`,
          sig: `updateIn${uname}At(i, fn)`,
          desc: "Update item at index with function",
        },
        {
          name: `deleteIn${uname}At`,
          sig: `deleteIn${uname}At(i)`,
          desc: "Delete item at index",
        },
        {
          name: `removeIn${uname}At`,
          sig: `removeIn${uname}At(i)`,
          desc: "Delete item at index (alias)",
        },
        {
          name: `pushIn${uname}`,
          sig: `pushIn${uname}(v)`,
          desc: "Push item to end",
        },
        {
          name: `insertIn${uname}At`,
          sig: `insertIn${uname}At(i, v)`,
          desc: "Insert item at index",
        },
      );
      break;
    case "map":
    case "omap": {
      const label = type === "omap" ? "ordered map" : "map";
      methods.push(
        {
          name: `${name}IsEmpty`,
          sig: `${name}IsEmpty()`,
          desc: `Check if ${label} is empty`,
        },
        {
          name: `${name}Len`,
          sig: `${name}Len()`,
          desc: `Get ${label} size`,
        },
        {
          name: `setIn${uname}At`,
          sig: `setIn${uname}At(key, v)`,
          desc: "Set value at key",
        },
        {
          name: `getIn${uname}At`,
          sig: `getIn${uname}At(key, defaultValue)`,
          desc: "Get value at key",
        },
        {
          name: `updateIn${uname}At`,
          sig: `updateIn${uname}At(key, fn)`,
          desc: "Update value at key with function",
        },
        {
          name: `deleteIn${uname}At`,
          sig: `deleteIn${uname}At(key)`,
          desc: "Delete entry at key",
        },
        {
          name: `removeIn${uname}At`,
          sig: `removeIn${uname}At(key)`,
          desc: "Delete entry at key (alias)",
        },
      );
      break;
    }
    case "set":
      methods.push(
        {
          name: `${name}IsEmpty`,
          sig: `${name}IsEmpty()`,
          desc: "Check if set is empty",
        },
        { name: `${name}Len`, sig: `${name}Len()`, desc: "Get set size" },
        {
          name: `addIn${uname}`,
          sig: `addIn${uname}(v)`,
          desc: "Add value to set",
        },
        {
          name: `deleteIn${uname}`,
          sig: `deleteIn${uname}(v)`,
          desc: "Remove value from set",
        },
        {
          name: `removeIn${uname}`,
          sig: `removeIn${uname}(v)`,
          desc: "Remove value from set (alias)",
        },
        {
          name: `hasIn${uname}`,
          sig: `hasIn${uname}(v)`,
          desc: "Check if value is in set",
        },
        {
          name: `toggleIn${uname}`,
          sig: `toggleIn${uname}(v)`,
          desc: "Toggle value in set",
        },
      );
      break;
  }

  return methods;
}

function serializeDefault(v) {
  if (v === null || v === undefined) return v;
  if (v?.toJS) return v.toJS();
  return v;
}

function getComponentDoc(comp) {
  const meta = comp.Class.getMetaClass();
  const { fields, name, methods } = meta;

  const userMethods = Object.keys(methods).map((k) => ({
    name: k,
    sig: getSignature(k, methods[k]),
  }));

  const inputHandlers = Object.keys(comp.input).map((k) => ({
    name: k,
    sig: getSignature(k, comp.input[k]),
  }));

  const fieldDocs = [];
  for (const fieldName in fields) {
    const field = fields[fieldName];
    fieldDocs.push({
      name: fieldName,
      type: field.type,
      default: serializeDefault(field.defaultValue),
      methods: getFieldMethods(field),
    });
  }

  return { name, methods: userMethods, input: inputHandlers, fields: fieldDocs };
}

export function getComponentsDocs(components) {
  return components.map((comp) => getComponentDoc(comp));
}

export function docsToMarkdown(docs) {
  const lines = [];
  for (const comp of docs) {
    lines.push(`# ${comp.name}\n`);

    if (comp.methods.length > 0) {
      lines.push("## Methods\n");
      for (const m of comp.methods) {
        lines.push(`- \`${m.sig}\``);
      }
      lines.push("");
    }

    if (comp.input.length > 0) {
      lines.push("## Input Handlers\n");
      for (const m of comp.input) {
        lines.push(`- \`${m.sig}\``);
      }
      lines.push("");
    }

    for (const field of comp.fields) {
      lines.push(
        `## Field: \`${field.name}\` (${field.type}, default: \`${JSON.stringify(field.default)}\`)\n`,
      );
      for (const m of field.methods) {
        lines.push(`- \`${m.sig}\` — ${m.desc}`);
      }
      lines.push("");
    }
  }
  return lines.join("\n");
}
