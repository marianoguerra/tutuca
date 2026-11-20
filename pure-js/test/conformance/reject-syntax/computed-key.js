// @expect computed-key
function (next, [k]) { next.f({ [k]: 1 }); }
