const PASS = "color: #0a0; font-weight: bold";
const FAIL = "color: #c00; font-weight: bold";
const SKIP = "color: #888";
const DIM = "color: #888";
const RESET = "color: inherit; font-weight: normal";

function reportTestNode(node) {
  if (node.children) {
    const label = node.componentName ? `${node.title} [${node.componentName}]` : node.title;
    console.group(label);
    for (const child of node.children) reportTestNode(child);
    console.groupEnd();
    return;
  }
  const dur = node.status === "skip" ? "" : ` (${Math.round(node.durationMs)}ms)`;
  if (node.status === "pass") {
    console.log(`%c✓%c ${node.title}%c${dur}`, PASS, RESET, DIM);
  } else if (node.status === "skip") {
    console.log(`%c○ ${node.title}%c (skipped)`, SKIP, RESET);
  } else {
    console.group(`%c✗%c ${node.title}%c${dur}`, FAIL, RESET, DIM);
    console.error(node.error?.message ?? "(no error message)");
    if (node.error && ("expected" in node.error || "actual" in node.error)) {
      console.log("expected:", node.error.expected);
      console.log("actual:  ", node.error.actual);
    }
    if (node.error?.stack) console.log(node.error.stack);
    console.groupEnd();
  }
}

export function reportTestReportToConsole(report) {
  for (const m of report.modules) {
    const label = `tutuca tests${m.path ? ` — ${m.path}` : ""}`;
    console.group(label);
    if (m.suites.length === 0) {
      console.log("(no tests)");
    } else {
      for (const s of m.suites) reportTestNode(s);
    }
    const c = m.counts;
    const summary = `${c.pass} passed, ${c.fail} failed, ${c.skip} skipped (${c.total} total)`;
    if (c.fail > 0) console.error(`%c${summary}`, FAIL);
    else if (c.total === 0) console.log(`%c${summary}`, DIM);
    else console.log(`%c${summary}`, PASS);
    console.groupEnd();
  }
  return report;
}
