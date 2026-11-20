// @data {"Shelf.defaults": "{ books?: string[] }"}
// @expect not-assignable
export const Shelf = { defaults: { books: [1] } };
