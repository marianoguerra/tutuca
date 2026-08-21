import { enableMapSet } from "immer";

// Runtime-wide opt-in. Keeping it in a shared module makes native Map/Set state work
// even when low-level Path/Transactor APIs are imported without the component builder.
enableMapSet();

export * from "immer";
