export const isPlainObject = (value) => {
  if (value === null || typeof value !== "object") return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
};

export const seqSize = (seq) => {
  if (seq == null) return 0;
  if (typeof seq.length === "number") return seq.length;
  if (typeof seq.size === "number") return seq.size;
  return isPlainObject(seq) ? Object.keys(seq).length : 0;
};

export const seqGet = (seq, key, dval = null) => {
  if (seq == null) return dval;
  if (seq instanceof Map) return seq.has(key) ? seq.get(key) : dval;
  if (seq instanceof Set) return seq.has(key) ? key : dval;
  if (Object.hasOwn(seq, key)) return seq[key];
  if (typeof seq.get === "function") return seq.get(key, dval);
  return dval;
};

export const isIndexedSeq = (seq) => Array.isArray(seq);
export const isKeyedSeq = (seq) => seq instanceof Map || isPlainObject(seq);
export const isSetSeq = (seq) => seq instanceof Set;

export function* seqEntries(seq) {
  if (seq instanceof Map) yield* seq.entries();
  else if (seq instanceof Set) for (const value of seq) yield [value, value];
  else if (isPlainObject(seq)) yield* Object.entries(seq);
  else if (Array.isArray(seq)) for (let i = 0; i < seq.length; i++) yield [i, seq[i]];
}
