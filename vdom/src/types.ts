// Type definitions
export type Props = Record<string, unknown>;

export interface DomOptions {
  document: Document;
}

// Informational diagnostics for diff/patch operations
export class Warning {
  constructor(
    public type: string,
    public message: string,
  ) {}
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
      `Duplicate keys found: [${keys}] in ${parentTag || "fragment"} at index ${parentIndex}. Nodes with duplicated keys are matched positionally.`,
    );
  }
}
