// @expect object-method
function (next) { next.f({ get x() { return 1; } }); }
