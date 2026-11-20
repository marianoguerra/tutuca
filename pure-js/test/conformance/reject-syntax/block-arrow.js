// @expect block-arrow
function (next) { next.items.forEach((it) => { it.done = true; }); }
