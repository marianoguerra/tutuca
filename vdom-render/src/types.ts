// Type definitions
export type Props = Record<string, unknown>;

export interface DomOptions {
  document: Document;
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
  constructor(
    public duplicatedKeys: Set<string>,
    public parentTag: string | null,
    public parentIndex: number,
  ) {
    const keys = [...duplicatedKeys].join(", ");
    super(
      "DuplicatedKeys",
      `Duplicate keys found: [${keys}] in ${parentTag || "fragment"} at index ${parentIndex}`,
    );
  }
}

export class NewKeyedNodeInReorderWarning extends Warning {
  constructor(
    public key: string,
    public parentTag: string | null,
    public parentIndex: number,
  ) {
    super(
      "NewKeyedNodeInReorder",
      `New keyed node "${key}" added during reorder in ${parentTag || "fragment"} at index ${parentIndex}. This is undefined behavior.`,
    );
  }
}
