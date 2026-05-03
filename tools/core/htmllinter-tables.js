// WHATWG HTML §13 spec-derived data tables for the HTML linter.
// All sets are lowercased except the SVG/MathML camel maps, which preserve case
// because they exist precisely to detect case-correction by the parser.

export const VOID_ELEMENTS = new Set([
  "area",
  "base",
  "br",
  "col",
  "embed",
  "hr",
  "img",
  "input",
  "link",
  "meta",
  "source",
  "track",
  "wbr",
]);

export const RAW_TEXT_ELEMENTS = new Set([
  "script",
  "style",
  "iframe",
  "noembed",
  "noframes",
  "noscript",
  "xmp",
  "plaintext",
]);

export const RCDATA_ELEMENTS = new Set(["textarea", "title"]);

// §13.2.4.2 "Special" — elements that affect scope tests and parser behavior.
// Trimmed of document-only entries (html, head, body, frame, frameset).
export const SPECIAL_ELEMENTS = new Set([
  "address",
  "applet",
  "area",
  "article",
  "aside",
  "base",
  "basefont",
  "bgsound",
  "blockquote",
  "br",
  "button",
  "caption",
  "center",
  "col",
  "colgroup",
  "dd",
  "details",
  "dir",
  "div",
  "dl",
  "dt",
  "embed",
  "fieldset",
  "figcaption",
  "figure",
  "footer",
  "form",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "header",
  "hgroup",
  "hr",
  "iframe",
  "img",
  "input",
  "keygen",
  "li",
  "link",
  "listing",
  "main",
  "marquee",
  "menu",
  "meta",
  "nav",
  "noembed",
  "noframes",
  "noscript",
  "object",
  "ol",
  "p",
  "param",
  "plaintext",
  "pre",
  "script",
  "search",
  "section",
  "select",
  "source",
  "style",
  "summary",
  "table",
  "tbody",
  "td",
  "template",
  "textarea",
  "tfoot",
  "th",
  "thead",
  "title",
  "tr",
  "track",
  "ul",
  "wbr",
  "xmp",
]);

// §13.2.5 — formatting elements participate in the active-formatting list
// and the adoption agency algorithm.
export const FORMATTING_ELEMENTS = new Set([
  "a",
  "b",
  "big",
  "code",
  "em",
  "font",
  "i",
  "nobr",
  "s",
  "small",
  "strike",
  "strong",
  "tt",
  "u",
]);

// "have an element in scope" — §13.2.4.2. The default set is the boundary
// elements; any of these stops the scope walk.
const DEFAULT_SCOPE_BOUNDARIES = new Set([
  "applet",
  "caption",
  "html",
  "table",
  "td",
  "th",
  "marquee",
  "object",
  "select",
  "template",
  // Foreign-content boundaries: svg, math foreign roots; tracked via ns.
]);

// Lowercased form of the integration-point names — foreign frames store the
// lowercased element name so these lookups don't depend on the source case.
export const MATHML_TEXT_INTEGRATION_POINT_NAMES = new Set(["mi", "mo", "mn", "ms", "mtext"]);
export const SVG_HTML_INTEGRATION_POINT_NAMES = new Set(["foreignobject", "desc", "title"]);

export const SCOPE_LIST_ITEM = new Set([...DEFAULT_SCOPE_BOUNDARIES, "ol", "ul"]);
export const SCOPE_BUTTON = new Set([...DEFAULT_SCOPE_BOUNDARIES, "button"]);
export const SCOPE_DEFAULT = DEFAULT_SCOPE_BOUNDARIES;
export const SCOPE_TABLE = new Set(["html", "table", "template"]);
export const SCOPE_SELECT = new Set(); // inverted in helper

// Names mandated by the WHATWG spec to be case-corrected when seen inside
// SVG foreign content. Anything else with uppercase will be lowercased.
// Source: §13.2.6.5 "Adjust SVG attributes" / "SVG element name adjustments".
export const STANDARD_SVG_CAMEL_ELEMENTS = new Set([
  "altGlyph",
  "altGlyphDef",
  "altGlyphItem",
  "animateColor",
  "animateMotion",
  "animateTransform",
  "clipPath",
  "feBlend",
  "feColorMatrix",
  "feComponentTransfer",
  "feComposite",
  "feConvolveMatrix",
  "feDiffuseLighting",
  "feDisplacementMap",
  "feDistantLight",
  "feDropShadow",
  "feFlood",
  "feFuncA",
  "feFuncB",
  "feFuncG",
  "feFuncR",
  "feGaussianBlur",
  "feImage",
  "feMerge",
  "feMergeNode",
  "feMorphology",
  "feOffset",
  "fePointLight",
  "feSpecularLighting",
  "feSpotLight",
  "feTile",
  "feTurbulence",
  "foreignObject",
  "glyphRef",
  "linearGradient",
  "radialGradient",
  "textPath",
]);

export const STANDARD_SVG_CAMEL_ATTRS = new Set([
  "attributeName",
  "attributeType",
  "baseFrequency",
  "baseProfile",
  "calcMode",
  "clipPathUnits",
  "diffuseConstant",
  "edgeMode",
  "filterUnits",
  "glyphRef",
  "gradientTransform",
  "gradientUnits",
  "kernelMatrix",
  "kernelUnitLength",
  "keyPoints",
  "keySplines",
  "keyTimes",
  "lengthAdjust",
  "limitingConeAngle",
  "markerHeight",
  "markerUnits",
  "markerWidth",
  "maskContentUnits",
  "maskUnits",
  "numOctaves",
  "pathLength",
  "patternContentUnits",
  "patternTransform",
  "patternUnits",
  "pointsAtX",
  "pointsAtY",
  "pointsAtZ",
  "preserveAlpha",
  "preserveAspectRatio",
  "primitiveUnits",
  "refX",
  "refY",
  "repeatCount",
  "repeatDur",
  "requiredExtensions",
  "requiredFeatures",
  "specularConstant",
  "specularExponent",
  "spreadMethod",
  "startOffset",
  "stdDeviation",
  "stitchTiles",
  "surfaceScale",
  "systemLanguage",
  "tableValues",
  "targetX",
  "targetY",
  "textLength",
  "viewBox",
  "xChannelSelector",
  "yChannelSelector",
  "zoomAndPan",
]);

// MathML adjustment list — only one per spec.
export const MATHML_CAMEL_ATTRS = new Set(["definitionURL"]);

// Reverse maps from lowercased name → canonical camelCase form. Built once
// at module load. Used to fire HTML_SVG_ATTR_WILL_LOWERCASE /
// HTML_MATHML_ATTR_WILL_LOWERCASE when authored attribute case doesn't
// match the canonical form the parser would case-correct to.
export const SVG_ATTR_LOWERCASE_TO_CAMEL = new Map();
for (const camel of STANDARD_SVG_CAMEL_ATTRS)
  SVG_ATTR_LOWERCASE_TO_CAMEL.set(camel.toLowerCase(), camel);
export const MATHML_ATTR_LOWERCASE_TO_CAMEL = new Map();
for (const camel of MATHML_CAMEL_ATTRS)
  MATHML_ATTR_LOWERCASE_TO_CAMEL.set(camel.toLowerCase(), camel);

// HTML breakout from foreign content (§13.2.6.5 "If the parser was originally
// created as part of the HTML fragment parsing algorithm").
export const FOREIGN_BREAKOUT_TAGS = new Set([
  "b",
  "big",
  "blockquote",
  "body",
  "br",
  "center",
  "code",
  "dd",
  "div",
  "dl",
  "dt",
  "em",
  "embed",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "head",
  "hr",
  "i",
  "img",
  "li",
  "listing",
  "menu",
  "meta",
  "nobr",
  "ol",
  "p",
  "pre",
  "ruby",
  "s",
  "small",
  "span",
  "strong",
  "strike",
  "sub",
  "sup",
  "table",
  "tt",
  "u",
  "ul",
  "var",
]);

// MathML text integration points — HTML can be re-entered through these.
export const MATHML_TEXT_INTEGRATION_POINTS = new Set(["mi", "mo", "mn", "ms", "mtext"]);

// Tags that close the currently-open <p> when opened (§13.2.6.4.7 "in body").
export const BLOCK_LEVEL_AUTO_CLOSE_P = new Set([
  "address",
  "article",
  "aside",
  "blockquote",
  "center",
  "details",
  "dialog",
  "dir",
  "div",
  "dl",
  "fieldset",
  "figcaption",
  "figure",
  "footer",
  "form",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "header",
  "hgroup",
  "hr",
  "main",
  "menu",
  "nav",
  "ol",
  "p",
  "plaintext",
  "pre",
  "search",
  "section",
  "summary",
  "table",
  "ul",
  "xmp",
  "li",
  "dd",
  "dt",
]);

// "in select" mode start tags that are ignored.
export const SELECT_VALID_CHILDREN = new Set(["option", "optgroup", "hr", "script", "template"]);

// Tags that close a <select> when opened in select mode.
export const SELECT_BREAKOUT_TAGS = new Set(["input", "keygen", "textarea", "select"]);

// Insertion-mode names. (Tutuca lints fragments only — document modes
// like Initial/BeforeHtml/InHead are intentionally absent.)
export const MODES = Object.freeze({
  inBody: "inBody",
  inTable: "inTable",
  inCaption: "inCaption",
  inColumnGroup: "inColumnGroup",
  inTableBody: "inTableBody",
  inRow: "inRow",
  inCell: "inCell",
  inSelect: "inSelect",
  inSelectInTable: "inSelectInTable",
  inTemplate: "inTemplate",
});

// Namespace constants.
export const NS = Object.freeze({
  html: "html",
  svg: "svg",
  math: "math",
});

// Initial-mode mapping for fragment-parsing context per §13.2.4.4.
export const FRAGMENT_CONTEXT_MODES = Object.freeze({
  template: { mode: MODES.inTemplate, ns: NS.html },
  body: { mode: MODES.inBody, ns: NS.html },
  div: { mode: MODES.inBody, ns: NS.html },
  table: { mode: MODES.inTable, ns: NS.html },
  tbody: { mode: MODES.inTableBody, ns: NS.html },
  thead: { mode: MODES.inTableBody, ns: NS.html },
  tfoot: { mode: MODES.inTableBody, ns: NS.html },
  caption: { mode: MODES.inCaption, ns: NS.html },
  colgroup: { mode: MODES.inColumnGroup, ns: NS.html },
  tr: { mode: MODES.inRow, ns: NS.html },
  td: { mode: MODES.inCell, ns: NS.html },
  th: { mode: MODES.inCell, ns: NS.html },
  select: { mode: MODES.inSelect, ns: NS.html },
  svg: { mode: MODES.inBody, ns: NS.svg },
  math: { mode: MODES.inBody, ns: NS.math },
});
