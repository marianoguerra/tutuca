// @expect assignment-expression
function (next) { next.f(next.count = 1); }
