import { getComponentsDocs } from "../../src/util/docs.js";
import { ComponentDocs } from "./results.js";

export function docComponents(normalized, { name = null } = {}) {
  const comps = normalized.components;
  const picked = name === null ? comps : comps.filter((c) => c.name === name);
  return new ComponentDocs({ items: getComponentsDocs(picked) });
}
