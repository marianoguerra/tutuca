import type { VBase } from "./vdom.ts";

// Type definitions
export type Props = Record<string, unknown>;

// setAttr return values
export const SET_ATTR_NOT_SUPPORTED = 0;
export const SET_ATTR_OK = 1;
export const SET_ATTR_OVERRIDE = 2;
export const SET_ATTR_OVERRIDE_SAME = 3;

export interface DomOptions {
  document: Document;
}

export class ReorderMove {
  from: number;
  key: string | null | undefined;

  constructor(from: number, key: string | null | undefined) {
    this.from = from;
    this.key = key;
  }
}

export class InsertMove {
  key: string;
  to: number;

  constructor(key: string, to: number) {
    this.key = key;
    this.to = to;
  }
}

export class Moves {
  removes: ReorderMove[];
  inserts: InsertMove[];

  constructor(removes: ReorderMove[], inserts: InsertMove[]) {
    this.removes = removes;
    this.inserts = inserts;
  }
}

// Warning system for diff/patch diagnostics
export class Warning {
  type: string;
  message: string;

  constructor(type: string, message: string) {
    this.type = type;
    this.message = message;
  }
}

export class DuplicatedKeysWarning extends Warning {
  duplicatedKeys: Set<string>;
  parentTag: string | null;
  parentIndex: number;

  constructor(
    duplicatedKeys: Set<string>,
    parentTag: string | null,
    parentIndex: number,
  ) {
    const keys = [...duplicatedKeys].join(", ");
    super(
      "DuplicatedKeys",
      `Duplicate keys found: [${keys}] in ${parentTag || "fragment"} at index ${parentIndex}`,
    );
    this.duplicatedKeys = duplicatedKeys;
    this.parentTag = parentTag;
    this.parentIndex = parentIndex;
  }
}

export class NewKeyedNodeInReorderWarning extends Warning {
  key: string;
  parentTag: string | null;
  parentIndex: number;

  constructor(key: string, parentTag: string | null, parentIndex: number) {
    super(
      "NewKeyedNodeInReorder",
      `New keyed node "${key}" added during reorder in ${parentTag || "fragment"} at index ${parentIndex}. This is undefined behavior.`,
    );
    this.key = key;
    this.parentTag = parentTag;
    this.parentIndex = parentIndex;
  }
}

export interface ReorderResult {
  children: (VBase | null)[];
  moves: Moves | null;
  duplicatedKeys: Set<string> | null;
  newKeyedNodes: string[] | null;
}

export interface KeyIndex {
  keys: Record<string, number>;
  free: number[];
  duplicatedKeys: Set<string> | null;
}
