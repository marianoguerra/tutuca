// @expect dynamic-import
function (next) { next.f(import("x")); }
