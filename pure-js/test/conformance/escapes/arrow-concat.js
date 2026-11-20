// @handler TodoList []
// @expect arrow-not-callback
function (next) { const o = Object.fromEntries([["toString"].concat(() => "runs when the host prints it")]); next.text = `${o}`; }
