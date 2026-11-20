// @expect for-of-statement
function (next) { for (const it of next.items) { it.done = true; } }
