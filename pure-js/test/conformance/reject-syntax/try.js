// @expect try-statement
function (next) { try { next.f(); } catch (e) {} }
