export function makeFormatter(name, table) {
  return {
    supports: new Set(Object.keys(table)),
    async format(result, opts) {
      const fn = table[result.constructor.name];
      if (!fn) {
        throw new Error(
          `${name} formatter missing dispatch for ${result.constructor.name}`,
        );
      }
      return await fn(result, opts);
    },
  };
}
