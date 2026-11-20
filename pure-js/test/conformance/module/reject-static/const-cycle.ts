// @expect const-cycle
const A = { b: B };
const B = { a: A };
