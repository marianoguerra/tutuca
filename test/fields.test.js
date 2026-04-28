import { describe, expect, test } from "bun:test";
import { List, Map as IMap, OrderedMap, Set as ISet } from "../deps/immutable.js";
import {
  classFromData,
  FieldAny,
  FieldBool,
  fieldsByTypeName,
  FieldFloat,
  FieldInt,
  FieldList,
  FieldMap,
  FieldOMap,
  FieldSet,
  FieldString,
} from "../src/oo.js";

const PRIMITIVES = [
  {
    name: "FieldBool",
    FieldCls: FieldBool,
    typeName: "bool",
    fieldName: "on",
    defaultValue: false,
    valid: [true, false],
    invalid: [0, "true", null],
    coerce: [
      [1, true],
      [0, false],
      ["yes", true],
      ["", false],
    ],
    rawSample: { input: true, expected: true },
    setSamples: [
      [1, true],
      [0, false],
    ],
    resetSpec: { defaultValue: true, mutateTo: false },
    specials: { toggle: true, truthy: { truthyValue: true } },
  },
  {
    name: "FieldInt",
    FieldCls: FieldInt,
    typeName: "int",
    fieldName: "count",
    defaultValue: 0,
    valid: [0, 42, -1],
    invalid: [3.14, "5", NaN, Infinity],
    coerce: [
      [3.7, 3],
      [-2.9, -2],
    ],
    coerceNull: [NaN, Infinity, "5"],
    descriptor: { type: "int", defaultValue: 10, expected: 10 },
    setSamples: [[5, 5]],
    update: { fn: (v) => v + 1, expected: 6 },
    resetSpec: { defaultValue: 42, mutateTo: 100 },
    specials: { truthy: { truthyValue: 5 } },
  },
  {
    name: "FieldFloat",
    FieldCls: FieldFloat,
    typeName: "float",
    fieldName: "ratio",
    defaultValue: 0,
    valid: [0, 3.14, -1.5],
    invalid: [NaN, Infinity, "3.14"],
    coerceNull: ["3.14", true],
    rawSample: { input: 2.5, expected: 2.5 },
    setSamples: [[3.14, 3.14]],
    update: { fn: (v) => v * 2, expected: 6.28 },
    resetSpec: { defaultValue: 0.5, mutateTo: 9.9 },
    specials: { truthy: { truthyValue: 3.14 } },
  },
  {
    name: "FieldString",
    FieldCls: FieldString,
    typeName: "text",
    fieldName: "label",
    defaultValue: "",
    valid: ["hello", ""],
    invalid: [42, null],
    coerce: [
      [42, "42"],
      [true, "true"],
    ],
    rawSample: { input: "hi", expected: "hi" },
    setSamples: [[123, "123"]],
    update: { fn: (v) => v.toUpperCase(), initial: "hello", expected: "HELLO" },
    resetSpec: { defaultValue: "default", mutateTo: "changed" },
    specials: {
      sized: { propName: "length", emptyExpected: 0, populated: "hello", populatedSize: 5 },
      truthy: { truthyValue: "hello" },
    },
  },
  {
    name: "FieldAny",
    FieldCls: FieldAny,
    typeName: "any",
    fieldName: "val",
    defaultValue: null,
    validAny: true,
    coerceIdentity: true,
    descriptor: { type: "any", defaultValue: null, expected: null },
    setSamples: [["hello", "hello"]],
    update: { fn: (v) => v.toUpperCase(), initial: "hello", expected: "HELLO" },
    resetSpec: {
      defaultValue: null,
      mutateTo: 42,
      descriptor: { type: "any", defaultValue: null },
    },
    specials: {
      isNull: { unsetValue: null, setValue: "something" },
      truthy: { truthyValue: "something" },
    },
  },
];

const COLLECTIONS = [
  {
    name: "FieldList",
    FieldCls: FieldList,
    typeName: "list",
    fieldName: "items",
    EmptyCtor: List,
    isCollection: List.isList,
    coerceFrom: { input: [1, 2, 3], size: 3 },
    classFromDataRaw: { input: [1, 2, 3], size: 3 },
    classFromDataImmutable: { input: List(["a", "b"]), size: 2 },
    keyedOps: {
      sample: ["a", "b", "c"],
      getKey: 1,
      getExpected: "b",
      setKey: 1,
      setValue: "B",
      updateInitial: List([10, 20, 30]),
      updateKey: 1,
      updateFn: (v) => v * 2,
      updateExpected: 40,
      deleteSample: ["a", "b", "c"],
      deleteKey: 1,
      afterDelete: { size: 2, getAt0: "a", getAt1: "c" },
      removeSample: ["a", "b", "c"],
      removeKey: 0,
      removeAfterAt0: "b",
    },
    setCoerce: { input: [4, 5, 6], size: 3 },
    sized: { initial: List([1, 2]), populatedSize: 2 },
    specials: { listOps: true },
  },
  {
    name: "FieldMap",
    FieldCls: FieldMap,
    typeName: "map",
    fieldName: "data",
    EmptyCtor: IMap,
    isCollection: IMap.isMap,
    coerceFrom: { input: { a: 1, b: 2 }, size: 2, sampleKey: "a", sampleValue: 1 },
    classFromDataRaw: { input: { a: 1, b: 2 }, sampleKey: "a", sampleValue: 1 },
    classFromDataImmutable: { input: IMap({ x: 10 }), sampleKey: "x", sampleValue: 10 },
    keyedOps: {
      sample: IMap({ k: "v" }),
      getKey: "k",
      getExpected: "v",
      setKey: "k",
      setValue: "v2",
      updateInitial: IMap({ n: 5 }),
      updateKey: "n",
      updateFn: (v) => v * 3,
      updateExpected: 15,
      deleteSample: IMap({ a: 1, b: 2 }),
      deleteKey: "a",
      afterDelete: { size: 1, missing: { key: "a", default: "gone" } },
      removeSample: IMap({ a: 1, b: 2 }),
      removeKey: "b",
      afterRemoveSize: 1,
    },
    setCoerce: { input: { x: 1 }, sampleKey: "x", sampleValue: 1 },
    sized: { initial: IMap({ a: 1, b: 2 }), populatedSize: 2 },
  },
  {
    name: "FieldOMap",
    FieldCls: FieldOMap,
    typeName: "omap",
    fieldName: "data",
    EmptyCtor: OrderedMap,
    isCollection: OrderedMap.isOrderedMap,
    coerceFrom: { input: { a: 1 }, sampleKey: "a", sampleValue: 1 },
    classFromDataImmutable: {
      input: OrderedMap({ x: 1, y: 2 }),
      sampleKey: "x",
      sampleValue: 1,
    },
    keyedOps: {
      sample: OrderedMap({ k: "v" }),
      getKey: "k",
      getExpected: "v",
      setKey: "k",
      setValue: "v2",
      updateInitial: OrderedMap({ n: 5 }),
      updateKey: "n",
      updateFn: (v) => v * 3,
      updateExpected: 15,
      deleteSample: OrderedMap({ a: 1, b: 2 }),
      deleteKey: "a",
      afterDeleteSize: 1,
      removeSample: OrderedMap({ a: 1, b: 2 }),
      removeKey: "b",
      afterRemoveSize: 1,
    },
    sized: { initial: OrderedMap({ a: 1 }), populatedSize: 1 },
    specials: { preservesOrder: true },
  },
  {
    name: "FieldSet",
    FieldCls: FieldSet,
    typeName: "set",
    fieldName: "tags",
    EmptyCtor: ISet,
    isCollection: ISet.isSet,
    coerceFrom: { input: [1, 2, 3], size: 3 },
    classFromDataRaw: { input: new Set(["a", "b"]), has: "a" },
    classFromDataImmutable: { input: ISet(["x", "y"]), size: 2 },
    classFromDataDescriptor: { type: "set", defaultValue: ["a"], has: "a" },
    setCoerce: { input: [1, 2, 3], size: 3 },
    sized: { initial: ISet([1, 2]), populatedSize: 2 },
    specials: { setOps: true, nativeSetCoerce: { input: new Set(["a", "b"]), size: 2, has: "a" } },
  },
];

function ucfirst(s) {
  return s[0].toUpperCase() + s.slice(1);
}

function describePrimitive(spec) {
  const { name, FieldCls, typeName, fieldName, defaultValue } = spec;
  const uname = ucfirst(fieldName);

  describe(name, () => {
    test("is registered in fieldsByTypeName", () => {
      expect(fieldsByTypeName[typeName]).toBe(FieldCls);
    });

    test("validates type", () => {
      const f = new FieldCls(fieldName);
      if (spec.validAny) {
        for (const v of ["string", 42, null, undefined, { a: 1 }]) expect(f.isValid(v)).toBe(true);
        return;
      }
      for (const v of spec.valid) expect(f.isValid(v)).toBe(true);
      for (const v of spec.invalid) expect(f.isValid(v)).toBe(false);
    });

    if (spec.coerce) {
      test("coerces", () => {
        const f = new FieldCls(fieldName);
        for (const [input, expected] of spec.coerce) expect(f.coerceOr(input)).toBe(expected);
      });
    }
    if (spec.coerceNull) {
      test("does not coerce invalid values", () => {
        const f = new FieldCls(fieldName);
        for (const v of spec.coerceNull) expect(f.coerceOr(v)).toBe(null);
      });
    }
    if (spec.coerceIdentity) {
      test("coercer returns value as-is", () => {
        const f = new FieldCls(fieldName);
        const obj = { x: 1 };
        expect(f.coerceOr(obj)).toBe(obj);
      });
    }

    test("default value", () => {
      const f = new FieldCls(fieldName);
      expect(f.defaultValue).toBe(defaultValue);
    });

    if (spec.rawSample) {
      test("classFromData detects raw value", () => {
        const Cls = classFromData(`${name}Raw`, { fields: { [fieldName]: spec.rawSample.input } });
        expect(Cls().get(fieldName)).toBe(spec.rawSample.expected);
      });
    }
    if (spec.descriptor) {
      test("classFromData with type descriptor", () => {
        const { type, defaultValue: dv, expected } = spec.descriptor;
        const Cls = classFromData(`${name}Desc`, {
          fields: { [fieldName]: { type, defaultValue: dv } },
        });
        expect(Cls().get(fieldName)).toBe(expected);
      });
    }

    test(`proto: set${uname}`, () => {
      const Cls = classFromData(`${name}Set`, mkFields(spec));
      const inst = Cls();
      for (const [arg, expected] of spec.setSamples) {
        expect(inst[`set${uname}`](arg).get(fieldName)).toBe(expected);
      }
    });

    if (spec.update) {
      test(`proto: update${uname}`, () => {
        const Cls = classFromData(`${name}Upd`, mkFields(spec, spec.update.initial));
        const initial =
          spec.update.initial !== undefined ? Cls() : Cls()[`set${uname}`](spec.setSamples[0][1]);
        const r = initial[`update${uname}`](spec.update.fn);
        expect(r.get(fieldName)).toBe(spec.update.expected);
      });
    }

    test(`proto: reset${uname}`, () => {
      const r = spec.resetSpec;
      const cfg = r.descriptor
        ? { fields: { [fieldName]: r.descriptor } }
        : { fields: { [fieldName]: r.defaultValue } };
      const Cls = classFromData(`${name}Reset`, cfg);
      const after = Cls()[`set${uname}`](r.mutateTo)[`reset${uname}`]();
      expect(after.get(fieldName)).toBe(r.defaultValue);
    });

    if (spec.specials?.toggle) {
      test(`proto: toggle${uname}`, () => {
        const Cls = classFromData(`${name}Toggle`, { fields: { [fieldName]: false } });
        const t1 = Cls()[`toggle${uname}`]();
        expect(t1.get(fieldName)).toBe(true);
        expect(t1[`toggle${uname}`]().get(fieldName)).toBe(false);
      });
    }

    if (spec.specials?.sized) {
      const { propName, emptyExpected, populated, populatedSize } = spec.specials.sized;
      test(`proto: is${uname}Empty and ${fieldName}Len (${propName})`, () => {
        const Cls = classFromData(`${name}Sized`, { fields: { [fieldName]: defaultValue } });
        const empty = Cls();
        expect(empty[`is${uname}Empty`]()).toBe(true);
        expect(empty[`${fieldName}Len`]()).toBe(emptyExpected);
        const filled = empty[`set${uname}`](populated);
        expect(filled[`is${uname}Empty`]()).toBe(false);
        expect(filled[`${fieldName}Len`]()).toBe(populatedSize);
      });
    }

    if (spec.specials?.isNull) {
      const { unsetValue, setValue } = spec.specials.isNull;
      test(`proto: is${uname}Null`, () => {
        const Cls = classFromData(`${name}IsNull`, mkFields(spec));
        const inst = Cls();
        expect(inst.get(fieldName)).toBe(unsetValue);
        expect(inst[`is${uname}Null`]()).toBe(true);
        const r = inst[`set${uname}`](setValue);
        expect(r[`is${uname}Null`]()).toBe(false);
      });
    }

    if (spec.specials?.truthy) {
      const { truthyValue } = spec.specials.truthy;
      test(`proto: is${uname}Truthy / is${uname}Falsy`, () => {
        const Cls = classFromData(`${name}Truthy`, mkFields(spec, spec.defaultValue));
        const inst = Cls();
        expect(inst[`is${uname}Truthy`]()).toBe(false);
        expect(inst[`is${uname}Falsy`]()).toBe(true);
        const r = inst[`set${uname}`](truthyValue);
        expect(r[`is${uname}Truthy`]()).toBe(true);
        expect(r[`is${uname}Falsy`]()).toBe(false);
      });
    }
  });
}

function mkFields(spec, overrideDefault) {
  const { fieldName } = spec;
  if (spec.descriptor) {
    return {
      fields: {
        [fieldName]: {
          type: spec.descriptor.type,
          defaultValue: overrideDefault ?? spec.descriptor.defaultValue,
        },
      },
    };
  }
  return { fields: { [fieldName]: overrideDefault ?? spec.defaultValue } };
}

function describeCollection(spec) {
  const { name, FieldCls, typeName, fieldName, EmptyCtor, isCollection } = spec;
  const uname = ucfirst(fieldName);

  describe(name, () => {
    test("is registered in fieldsByTypeName", () => {
      expect(fieldsByTypeName[typeName]).toBe(FieldCls);
    });

    test("validates collection values", () => {
      const f = new FieldCls(fieldName);
      expect(f.isValid(EmptyCtor())).toBe(true);
      const sample = spec.classFromDataImmutable?.input ?? spec.coerceFrom.input;
      // build a populated immutable instance for the valid test
      if (isCollection(sample)) expect(f.isValid(sample)).toBe(true);
      // coerced inputs are not valid as-is
      expect(f.isValid(spec.coerceFrom.input)).toBe(false);
      expect(f.isValid("nope")).toBe(false);
    });

    test("coerces to collection", () => {
      const f = new FieldCls(fieldName);
      const result = f.coerceOr(spec.coerceFrom.input);
      expect(isCollection(result)).toBe(true);
      if (spec.coerceFrom.size !== undefined) expect(result.size).toBe(spec.coerceFrom.size);
      if (spec.coerceFrom.sampleKey !== undefined) {
        expect(result.get(spec.coerceFrom.sampleKey)).toBe(spec.coerceFrom.sampleValue);
      }
    });

    if (spec.specials?.nativeSetCoerce) {
      const ns = spec.specials.nativeSetCoerce;
      test("coerces native Set to ISet", () => {
        const f = new FieldCls(fieldName);
        const result = f.coerceOr(ns.input);
        expect(isCollection(result)).toBe(true);
        expect(result.size).toBe(ns.size);
        expect(result.has(ns.has)).toBe(true);
      });
    }

    test("default value is empty collection", () => {
      const f = new FieldCls(fieldName);
      expect(isCollection(f.defaultValue)).toBe(true);
      expect(f.defaultValue.size).toBe(0);
    });

    if (spec.classFromDataRaw) {
      test("classFromData detects raw value", () => {
        const r = spec.classFromDataRaw;
        const Cls = classFromData(`${name}Raw`, { fields: { [fieldName]: r.input } });
        const inst = Cls();
        expect(isCollection(inst.get(fieldName))).toBe(true);
        if (r.size !== undefined) expect(inst.get(fieldName).size).toBe(r.size);
        if (r.has !== undefined) expect(inst.get(fieldName).has(r.has)).toBe(true);
        if (r.sampleKey !== undefined) {
          expect(inst.get(fieldName).get(r.sampleKey)).toBe(r.sampleValue);
        }
      });
    }
    if (spec.classFromDataImmutable) {
      test("classFromData detects immutable value", () => {
        const r = spec.classFromDataImmutable;
        const Cls = classFromData(`${name}Imm`, { fields: { [fieldName]: r.input } });
        const inst = Cls();
        expect(isCollection(inst.get(fieldName))).toBe(true);
        if (r.size !== undefined) expect(inst.get(fieldName).size).toBe(r.size);
        if (r.sampleKey !== undefined) {
          expect(inst.get(fieldName).get(r.sampleKey)).toBe(r.sampleValue);
        }
      });
    }
    if (spec.classFromDataDescriptor) {
      test("classFromData with type descriptor", () => {
        const { type, defaultValue, has } = spec.classFromDataDescriptor;
        const Cls = classFromData(`${name}Desc`, {
          fields: { [fieldName]: { type, defaultValue } },
        });
        const inst = Cls();
        expect(isCollection(inst.get(fieldName))).toBe(true);
        expect(inst.get(fieldName).has(has)).toBe(true);
      });
    }

    if (spec.sized) {
      test(`proto: is${uname}Empty and ${fieldName}Len`, () => {
        const Cls = classFromData(`${name}Sized`, { fields: { [fieldName]: EmptyCtor() } });
        const empty = Cls();
        expect(empty[`is${uname}Empty`]()).toBe(true);
        expect(empty[`${fieldName}Len`]()).toBe(0);
        const filled = empty[`set${uname}`](spec.sized.initial);
        expect(filled[`is${uname}Empty`]()).toBe(false);
        expect(filled[`${fieldName}Len`]()).toBe(spec.sized.populatedSize);
      });

      test(`proto: is${uname}Truthy / is${uname}Falsy (size-based)`, () => {
        const Cls = classFromData(`${name}Truthy`, { fields: { [fieldName]: EmptyCtor() } });
        const empty = Cls();
        expect(empty[`is${uname}Truthy`]()).toBe(false);
        expect(empty[`is${uname}Falsy`]()).toBe(true);
        const filled = empty[`set${uname}`](spec.sized.initial);
        expect(filled[`is${uname}Truthy`]()).toBe(true);
        expect(filled[`is${uname}Falsy`]()).toBe(false);
      });
    }

    if (spec.keyedOps) {
      const k = spec.keyedOps;

      test(`proto: setIn${uname}At and getIn${uname}At`, () => {
        const Cls = classFromData(`${name}Access`, { fields: { [fieldName]: k.sample } });
        const inst = Cls();
        expect(inst[`getIn${uname}At`](k.getKey)).toBe(k.getExpected);
        expect(inst[`setIn${uname}At`](k.setKey, k.setValue)[`getIn${uname}At`](k.setKey)).toBe(
          k.setValue,
        );
      });

      test(`proto: updateIn${uname}At`, () => {
        const Cls = classFromData(`${name}Upd`, { fields: { [fieldName]: k.updateInitial } });
        const r = Cls()[`updateIn${uname}At`](k.updateKey, k.updateFn);
        expect(r[`getIn${uname}At`](k.updateKey)).toBe(k.updateExpected);
      });

      test(`proto: deleteIn${uname}At / removeIn${uname}At`, () => {
        const Cls = classFromData(`${name}Del`, { fields: { [fieldName]: k.deleteSample } });
        const inst = Cls();
        const after = inst[`deleteIn${uname}At`](k.deleteKey);
        if (k.afterDelete) {
          expect(after[`${fieldName}Len`]()).toBe(k.afterDelete.size);
          if (k.afterDelete.getAt0 !== undefined) {
            expect(after[`getIn${uname}At`](0)).toBe(k.afterDelete.getAt0);
            expect(after[`getIn${uname}At`](1)).toBe(k.afterDelete.getAt1);
          }
          if (k.afterDelete.missing) {
            expect(
              after[`getIn${uname}At`](k.afterDelete.missing.key, k.afterDelete.missing.default),
            ).toBe(k.afterDelete.missing.default);
          }
        } else if (k.afterDeleteSize !== undefined) {
          expect(after[`${fieldName}Len`]()).toBe(k.afterDeleteSize);
        }
        const removed = inst[`removeIn${uname}At`](k.removeKey);
        if (k.removeAfterAt0 !== undefined) {
          expect(removed[`getIn${uname}At`](0)).toBe(k.removeAfterAt0);
        }
        if (k.afterRemoveSize !== undefined) {
          expect(removed[`${fieldName}Len`]()).toBe(k.afterRemoveSize);
        }
      });
    }

    if (spec.setCoerce) {
      test(`proto: set${uname} coerces`, () => {
        const Cls = classFromData(`${name}SetCoerce`, { fields: { [fieldName]: EmptyCtor() } });
        const r = Cls()[`set${uname}`](spec.setCoerce.input);
        expect(isCollection(r.get(fieldName))).toBe(true);
        if (spec.setCoerce.size !== undefined)
          expect(r.get(fieldName).size).toBe(spec.setCoerce.size);
        if (spec.setCoerce.sampleKey !== undefined) {
          expect(r[`getIn${uname}At`](spec.setCoerce.sampleKey)).toBe(spec.setCoerce.sampleValue);
        }
      });
    }

    test(`proto: reset${uname}`, () => {
      const Cls = classFromData(`${name}Reset`, { fields: { [fieldName]: EmptyCtor() } });
      const populated = Cls()[`set${uname}`](spec.sized?.initial ?? spec.coerceFrom.input);
      expect(populated[`reset${uname}`]()[`${fieldName}Len`]()).toBe(0);
    });

    if (spec.specials?.listOps) {
      test(`proto: pushIn${uname}`, () => {
        const Cls = classFromData(`${name}Push`, { fields: { [fieldName]: [] } });
        const r = Cls()[`pushIn${uname}`]("a")[`pushIn${uname}`]("b");
        expect(r[`${fieldName}Len`]()).toBe(2);
        expect(r[`getIn${uname}At`](0)).toBe("a");
        expect(r[`getIn${uname}At`](1)).toBe("b");
      });

      test(`proto: insertIn${uname}At`, () => {
        const Cls = classFromData(`${name}Insert`, { fields: { [fieldName]: [1, 3] } });
        const r = Cls()[`insertIn${uname}At`](1, 2);
        expect(r[`getIn${uname}At`](0)).toBe(1);
        expect(r[`getIn${uname}At`](1)).toBe(2);
        expect(r[`getIn${uname}At`](2)).toBe(3);
      });
    }

    if (spec.specials?.setOps) {
      test(`proto: addIn${uname}`, () => {
        const Cls = classFromData(`${name}Add`, { fields: { [fieldName]: ISet() } });
        const r = Cls()[`addIn${uname}`]("hello");
        expect(r.get(fieldName).has("hello")).toBe(true);
        expect(r[`${fieldName}Len`]()).toBe(1);
      });

      test(`proto: addIn${uname} deduplicates`, () => {
        const Cls = classFromData(`${name}Dedup`, { fields: { [fieldName]: ISet() } });
        const r = Cls()[`addIn${uname}`]("a")[`addIn${uname}`]("a")[`addIn${uname}`]("b");
        expect(r[`${fieldName}Len`]()).toBe(2);
      });

      test(`proto: deleteIn${uname} / removeIn${uname}`, () => {
        const Cls = classFromData(`${name}SetDel`, { fields: { [fieldName]: ISet([1, 2, 3]) } });
        const inst = Cls();
        const r = inst[`deleteIn${uname}`](2);
        expect(r.get(fieldName).has(2)).toBe(false);
        expect(r[`${fieldName}Len`]()).toBe(2);
        expect(inst[`removeIn${uname}`](3).get(fieldName).has(3)).toBe(false);
      });

      test(`proto: hasIn${uname}`, () => {
        const Cls = classFromData(`${name}Has`, { fields: { [fieldName]: ISet(["a", "b"]) } });
        const inst = Cls();
        expect(inst[`hasIn${uname}`]("a")).toBe(true);
        expect(inst[`hasIn${uname}`]("z")).toBe(false);
      });

      test(`proto: toggleIn${uname} adds when absent`, () => {
        const Cls = classFromData(`${name}Toggle`, { fields: { [fieldName]: ISet() } });
        const r = Cls()[`toggleIn${uname}`]("foo");
        expect(r[`hasIn${uname}`]("foo")).toBe(true);
      });

      test(`proto: toggleIn${uname} removes when present`, () => {
        const Cls = classFromData(`${name}Toggle2`, { fields: { [fieldName]: ISet() } });
        const inst = Cls()[`addIn${uname}`]("foo");
        expect(inst[`toggleIn${uname}`]("foo")[`hasIn${uname}`]("foo")).toBe(false);
      });

      test(`proto: toggleIn${uname} round trip`, () => {
        const Cls = classFromData(`${name}Toggle3`, { fields: { [fieldName]: ISet() } });
        const step1 = Cls()[`toggleIn${uname}`]("bar");
        expect(step1[`hasIn${uname}`]("bar")).toBe(true);
        expect(step1[`toggleIn${uname}`]("bar")[`hasIn${uname}`]("bar")).toBe(false);
      });
    }

    if (spec.specials?.preservesOrder) {
      test("proto: preserves insertion order", () => {
        const Cls = classFromData(`${name}Order`, { fields: { [fieldName]: OrderedMap() } });
        const inst = Cls()
          [`set${uname}`](OrderedMap())
          [`set${uname}`](OrderedMap().set("b", 2).set("a", 1).set("c", 3));
        expect(inst.get(fieldName).keySeq().toArray()).toEqual(["b", "a", "c"]);
      });
    }
  });
}

for (const spec of PRIMITIVES) describePrimitive(spec);
for (const spec of COLLECTIONS) describeCollection(spec);
