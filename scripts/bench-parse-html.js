// In-browser micro-benchmark: five strategies for parsing an HTML string into
// an Array<Node> of top-level children. Run by opening bench-parse-html.html
// from a local static server (modern browsers block ESM imports from file://).
//
// Why we rotate over a corpus of distinct inputs instead of reusing one string:
// no major engine memoizes parsed-fragment output keyed by the source string,
// but feeding the *same* string in a tight loop biases results 5-15% via
// IC/hidden-class stabilization, allocator warmth, branch-predictor fit, and
// atomized tag/attr name reuse. Rotating defeats those artifacts.
// Refs:
//   https://groups.google.com/a/chromium.org/g/blink-dev/c/AUqsuLq70kA
//   https://github.com/WebKit/WebKit/pull/9926
//   https://bugzilla.mozilla.org/show_bug.cgi?id=386769
//   https://bugzilla.mozilla.org/show_bug.cgi?id=1347525
//   https://v8.dev/blog/scanner
//
// Note on Blink/WebKit's HTMLDocumentParserFastPath: it fires only for
// Element.setInnerHTML/setOuterHTML on regular HTML elements, NOT for
// DOMParser.parseFromString and NOT for template.innerHTML. So none of our
// five variants benefit asymmetrically from it. A <div>-based variant would
// hit the fast path but cannot serve as a drop-in: <div> fragment parsing
// uses "in body" insertion mode, which silently strips bare <tr>/<option>
// that <template> preserves. Excluded for that reason.

const CORPUS_SIZE = 32;
const SAMPLES = 30;
const CALIBRATION_TARGET_MS = 20;
const WARMUP_MS = 200;
const MAX_ITERS_PER_SAMPLE = 1 << 20;
const BUCKETS = ["tiny", "small", "medium", "large"];
const DEFAULT_SEED = 1;

const _parser = new DOMParser();
const _tpl = document.createElement("template");

const VARIANTS = {
  singletonDOMParser(html) {
    return Array.from(_parser.parseFromString(html, "text/html").body.childNodes);
  },
  perCallDOMParser(html) {
    return Array.from(new DOMParser().parseFromString(html, "text/html").body.childNodes);
  },
  singletonTemplateReplaceChildren(html) {
    _tpl.innerHTML = html;
    const result = Array.from(_tpl.content.childNodes);
    _tpl.content.replaceChildren();
    return result;
  },
  singletonTemplateInnerHTMLEmpty(html) {
    _tpl.innerHTML = html;
    const result = Array.from(_tpl.content.childNodes);
    _tpl.innerHTML = "";
    return result;
  },
  perCallTemplate(html) {
    const tpl = document.createElement("template");
    tpl.innerHTML = html;
    return Array.from(tpl.content.childNodes);
  },
};

const VARIANT_NAMES = Object.keys(VARIANTS);

function makeRng(seed) {
  let s = seed >>> 0 || 1;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s;
  };
}

function buildCorpus(seed) {
  const rng = makeRng(seed);
  const word = () => `w${rng() % 100000}`;
  const corpus = { tiny: [], small: [], medium: [], large: [] };
  for (let i = 0; i < CORPUS_SIZE; i++) {
    corpus.tiny.push(`<p id="p${i}">${word()} ${word()}</p>`);

    corpus.small.push(
      `<form id="f${i}">` +
        `<label for="x${i}">${word()}</label>` +
        `<input id="x${i}" name="${word()}" value="${word()}">` +
        `<select name="${word()}"><option>${word()}</option><option>${word()}</option></select>` +
        `<button type="submit">${word()}</button>` +
        `</form>`,
    );

    const rows = [];
    for (let j = 0; j < 50; j++) {
      rows.push(
        `<tr><td>${word()}</td><td>${word()}</td><td>${word()}</td><td>${word()}</td></tr>`,
      );
    }
    corpus.medium.push(
      `<table><thead><tr><th>a</th><th>b</th><th>c</th><th>d</th></tr></thead><tbody>${rows.join("")}</tbody></table>`,
    );

    const sections = [];
    for (let j = 0; j < 12; j++) {
      const items = [];
      for (let k = 0; k < 18; k++) {
        items.push(`<li data-k="${k}">${word()} <em>${word()}</em> <span>${word()}</span></li>`);
      }
      sections.push(
        `<section><h2>${word()}</h2><p>${word()} ${word()} ${word()}.</p><ul>${items.join("")}</ul></section>`,
      );
    }
    corpus.large.push(`<article id="a${i}">${sections.join("")}</article>`);
  }
  return corpus;
}

const serializeNodes = (nodes) =>
  nodes
    .map((n) =>
      n.nodeType === 1
        ? n.outerHTML
        : n.nodeType === 3
          ? `#text:${n.data}`
          : n.nodeType === 8
            ? `#comment:${n.data}`
            : `#${n.nodeType}`,
    )
    .join("|");

function checkEquivalence(corpus) {
  let runs = 0;
  for (const bucket of BUCKETS) {
    const inputs = corpus[bucket];
    for (let i = 0; i < inputs.length; i++) {
      const html = inputs[i];
      let canonical = null;
      let canonicalFrom = null;
      for (const vname of VARIANT_NAMES) {
        const out = serializeNodes(VARIANTS[vname](html));
        runs++;
        if (canonical === null) {
          canonical = out;
          canonicalFrom = vname;
        } else if (out !== canonical) {
          throw new Error(
            `equivalence mismatch in bucket=${bucket} index=${i}\n` +
              `  ${canonicalFrom}: ${canonical.slice(0, 240)}\n` +
              `  ${vname}: ${out.slice(0, 240)}\n` +
              `  input: ${html.slice(0, 240)}`,
          );
        }
      }
    }
  }
  return runs;
}

let sink = 0;

function timeOnce(fn, corpus, iters) {
  const n = corpus.length;
  const start = performance.now();
  for (let i = 0; i < iters; i++) {
    const r = fn(corpus[i % n]);
    sink += r.length;
  }
  return performance.now() - start;
}

function calibrate(fn, corpus) {
  let iters = 1;
  while (iters < MAX_ITERS_PER_SAMPLE) {
    const ms = timeOnce(fn, corpus, iters);
    if (ms >= CALIBRATION_TARGET_MS) return iters;
    iters *= 2;
  }
  return MAX_ITERS_PER_SAMPLE;
}

function warmup(fn, corpus, iters) {
  const start = performance.now();
  while (performance.now() - start < WARMUP_MS) {
    timeOnce(fn, corpus, iters);
  }
}

const yieldToBrowser = () => new Promise((r) => setTimeout(r, 0));

async function sampleVariant(fn, corpus, iters) {
  const samples = new Array(SAMPLES);
  for (let i = 0; i < SAMPLES; i++) {
    const ms = timeOnce(fn, corpus, iters);
    samples[i] = (ms * 1e6) / iters;
    await yieldToBrowser();
  }
  return samples;
}

function computeStats(samples) {
  const sorted = [...samples].sort((a, b) => a - b);
  const n = sorted.length;
  const min = sorted[0];
  const median = n % 2 ? sorted[(n - 1) / 2] : (sorted[n / 2 - 1] + sorted[n / 2]) / 2;
  let sum = 0;
  for (const v of sorted) sum += v;
  const mean = sum / n;
  let varSum = 0;
  for (const v of sorted) varSum += (v - mean) ** 2;
  const stdev = Math.sqrt(varSum / n);
  const p95 = sorted[Math.min(n - 1, Math.floor(n * 0.95))];
  const rsd = mean === 0 ? 0 : (stdev / mean) * 100;
  const opsPerSec = median === 0 ? Infinity : 1e9 / median;
  return { min, median, mean, p95, rsd, opsPerSec };
}

function fmtNs(v) {
  if (v >= 1e6) return `${(v / 1e6).toFixed(2)} ms`;
  if (v >= 1e3) return `${(v / 1e3).toFixed(2)} µs`;
  return `${v.toFixed(1)} ns`;
}

function fmtOps(v) {
  if (!Number.isFinite(v)) return "∞";
  return v.toLocaleString("en-US", { maximumFractionDigits: 0 });
}

function probeTimerResolution() {
  const probes = [];
  let last = performance.now();
  for (let i = 0; i < 5000 && probes.length < 200; i++) {
    const t = performance.now();
    if (t > last) {
      probes.push(t - last);
      last = t;
    }
  }
  if (probes.length === 0) return 0;
  probes.sort((a, b) => a - b);
  return probes[0];
}

function renderEnv(target) {
  const res = probeTimerResolution();
  const mem = performance.memory
    ? `${(performance.memory.jsHeapSizeLimit / (1024 * 1024)).toFixed(0)} MB heap limit`
    : "n/a (browser does not expose performance.memory)";
  target.innerHTML = "";
  const lines = [
    ["UA", navigator.userAgent],
    ["cores", String(navigator.hardwareConcurrency ?? "?")],
    ["screen", `${screen.width}×${screen.height} @ ${devicePixelRatio}x`],
    ["perf.now() resolution", res > 0 ? `${(res * 1000).toFixed(2)} µs` : "<sub-µs>"],
    ["memory", mem],
  ];
  for (const [k, v] of lines) {
    const div = document.createElement("div");
    const b = document.createElement("b");
    b.textContent = `${k}: `;
    div.appendChild(b);
    div.append(v);
    target.appendChild(div);
  }
}

function renderTable(target, bucket, results) {
  const sorted = [...results].sort((a, b) => a.median - b.median);
  const fastest = sorted[0].median;

  const h3 = document.createElement("h3");
  h3.textContent = `${bucket}  (corpus ${CORPUS_SIZE} × ~${approxBytes(bucket)} bytes/input)`;
  target.appendChild(h3);

  const table = document.createElement("table");
  const thead = document.createElement("thead");
  thead.innerHTML =
    "<tr><th>variant</th><th>median</th><th>mean</th><th>min</th>" +
    "<th>p95</th><th>ops/sec</th><th>rsd%</th><th>iters/sample</th></tr>";
  table.appendChild(thead);
  const tbody = document.createElement("tbody");
  for (const r of sorted) {
    const tr = document.createElement("tr");
    if (r.median === fastest) tr.className = "winner";
    const cells = [
      r.variant,
      fmtNs(r.median),
      fmtNs(r.mean),
      fmtNs(r.min),
      fmtNs(r.p95),
      fmtOps(r.opsPerSec),
      r.rsd > 10 ? `${r.rsd.toFixed(1)} ⚠` : r.rsd.toFixed(1),
      String(r.iters),
    ];
    for (let i = 0; i < cells.length; i++) {
      const td = document.createElement("td");
      td.textContent = cells[i];
      if (i === 6 && r.rsd > 10) td.classList.add("warn");
      tr.appendChild(td);
    }
    tbody.appendChild(tr);
  }
  table.appendChild(tbody);
  target.appendChild(table);

  const ratiosEl = document.createElement("p");
  ratiosEl.className = "ratios";
  ratiosEl.textContent = sorted
    .map((r) => `${r.variant}: ${(r.median / fastest).toFixed(2)}×`)
    .join("  |  ");
  target.appendChild(ratiosEl);
}

function approxBytes(bucket) {
  return { tiny: 30, small: 250, medium: 3000, large: 30000 }[bucket] ?? 0;
}

function urlSeed() {
  const s = new URLSearchParams(location.search).get("seed");
  if (!s) return DEFAULT_SEED;
  const n = Number.parseInt(s, 10);
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_SEED;
}

async function runBench({ env, progress, results }) {
  renderEnv(env);
  results.replaceChildren();
  sink = 0;

  const seed = urlSeed();
  progress.textContent = `building corpus (seed=${seed})...`;
  await yieldToBrowser();
  const corpus = buildCorpus(seed);

  progress.textContent = "checking equivalence across all variants & inputs...";
  await yieldToBrowser();
  const checked = checkEquivalence(corpus);
  const okLine = document.createElement("p");
  okLine.textContent = `equivalence: ok (${checked} runs across ${VARIANT_NAMES.length} variants × ${CORPUS_SIZE} inputs × ${BUCKETS.length} buckets)`;
  results.appendChild(okLine);

  const startWall = performance.now();

  for (const bucket of BUCKETS) {
    const inputs = corpus[bucket];
    const bucketResults = [];

    for (const vname of VARIANT_NAMES) {
      const fn = VARIANTS[vname];

      progress.textContent = `[${bucket}] ${vname}: calibrating...`;
      await yieldToBrowser();
      const iters = calibrate(fn, inputs);

      progress.textContent = `[${bucket}] ${vname}: warming up (${iters} iters/sample)...`;
      await yieldToBrowser();
      warmup(fn, inputs, iters);

      progress.textContent = `[${bucket}] ${vname}: sampling (${SAMPLES} samples × ${iters} iters)...`;
      await yieldToBrowser();
      const samples = await sampleVariant(fn, inputs, iters);
      const stats = computeStats(samples);
      bucketResults.push({ variant: vname, iters, ...stats });
    }

    renderTable(results, bucket, bucketResults);
    await yieldToBrowser();
  }

  const wallMs = performance.now() - startWall;

  const meta = document.createElement("p");
  meta.className = "meta";
  meta.textContent =
    `done in ${(wallMs / 1000).toFixed(1)}s — ` +
    `samples=${SAMPLES}, corpus_size=${CORPUS_SIZE}, seed=${seed}, sink=${sink} ` +
    `(append ?seed=N to the URL to change inputs)`;
  results.appendChild(meta);

  progress.textContent = `done in ${(wallMs / 1000).toFixed(1)}s`;
}

function init() {
  const button = document.getElementById("run");
  const progress = document.getElementById("progress");
  const results = document.getElementById("results");
  const env = document.getElementById("env");

  renderEnv(env);

  button.addEventListener("click", async () => {
    button.disabled = true;
    try {
      await runBench({ env, progress, results });
    } catch (err) {
      progress.textContent = `error: ${err.message}`;
      console.error(err);
      const pre = document.createElement("pre");
      pre.style.color = "var(--warn)";
      pre.style.whiteSpace = "pre-wrap";
      pre.textContent = err.stack ?? String(err);
      results.appendChild(pre);
    } finally {
      button.disabled = false;
    }
  });
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", init);
} else {
  init();
}
