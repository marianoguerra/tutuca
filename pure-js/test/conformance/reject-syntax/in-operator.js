// @expect in-operator
function (next, [k]) { if (k in next) return; }
