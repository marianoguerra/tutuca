// @expect array-hole
function (next) { next.f([1, , 2]); }
