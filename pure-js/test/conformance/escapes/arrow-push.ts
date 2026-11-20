// @handler TodoList []
// @expect arrow-not-callback
function (next) { const xs: unknown[] = []; xs.push((ok) => ok(1)); next.tags = Object.fromEntries([["then", xs[0]]]); }
