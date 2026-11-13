// What the terminal can show, from the environment: how many colors and whether it draws Unicode.
// Ported from tuiuiu.js (core/terminal-profile.ts and core/capabilities.ts; MIT, see
// LICENSE.tuiuiu), with NO_COLOR and FORCE_COLOR as their conventions say.
//
// colors is "truecolor", 256, 16 or 0 (no color, attributes only); paint keeps full colors in
// the cells and the output reduces them to this (buffer.js's toTerminal).

// Terminals that set an environment variable of their own, and whether they draw 24-bit color.
const PROFILES = [
	[(e) => e.KITTY_WINDOW_ID, true],
	[(e) => e.ALACRITTY_WINDOW_ID || e.ALACRITTY_LOG, true],
	[(e) => e.GHOSTTY_RESOURCES_DIR, true],
	[(e) => e.WEZTERM_PANE || e.TERM_PROGRAM === "WezTerm", true],
	[(e) => e.TERM_PROGRAM === "rio", true],
	[(e) => e.WARP_IS_LOCAL_SHELL_SESSION, true],
	[(e) => (e.TERM ?? "").startsWith("foot"), true],
	[(e) => e.CONTOUR_TERMINAL_ID, true],
	[(e) => e.VSCODE_PID || e.TERM_PROGRAM === "vscode", true],
	[(e) => e.TERM_PROGRAM === "iTerm.app", true],
	[(e) => e.TERM_PROGRAM === "Apple_Terminal", false],
	[(e) => e.WT_SESSION, true],
	[(e) => e.KONSOLE_VERSION, true],
	[(e) => e.VTE_VERSION, true], // GNOME Terminal, Tilix and other VTE terminals.
	[(e) => e.TERM_PROGRAM === "Hyper", true],
	[(e) => e.TERMINOLOGY, true],
	[(e) => e.TERM_PROGRAM === "mlterm", true],
	[(e) => e.TERM_PROGRAM === "blackbox" || e.BLACKBOX_THEMES_DIR, true],
	[(e) => e.TERM_PROGRAM === "Bobcat", true],
	[(e) => (e.TERM ?? "").includes("rxvt"), false],
	[(e) => e.TERM === "st" || e.TERM === "st-256color", true],
];
const FORCED = { 0: 0, 1: 16, 2: 256, 3: "truecolor" };

export function detectColors(env) {
	// NO_COLOR, set to anything but empty, turns color off (no-color.org); FORCE_COLOR 0 to 3
	// picks a level (as chalk and Node read it).
	if (env.FORCE_COLOR !== undefined && env.FORCE_COLOR in FORCED) return FORCED[env.FORCE_COLOR];
	if (env.NO_COLOR) return 0;
	const term = env.TERM ?? "";
	if (term === "dumb") return 0;
	const colorTerm = (env.COLORTERM ?? "").toLowerCase();
	const known = PROFILES.find(([test]) => test(env));
	if (colorTerm === "truecolor" || colorTerm === "24bit" || known?.[1]) return "truecolor";
	if (term.includes("256color") || known !== undefined) return 256;
	return 16;
}

// Whether box drawing, blocks and ellipses show: not on the Linux console, a dumb or VT
// terminal, CI logs or a locale that isn't UTF-8.
export function detectUnicode(env) {
	const term = env.TERM ?? "";
	if (term === "linux" || term === "dumb" || term.startsWith("vt")) return false;
	if (env.CI || env.GITHUB_ACTIONS || env.GITLAB_CI || env.BUILDKITE || env.JENKINS_URL)
		return false;
	if (env.WT_SESSION || process.platform === "win32") return true;
	const locale = env.LC_ALL || env.LC_CTYPE || env.LANG || "";
	return locale === "" || /utf-?8/i.test(locale);
}

// { colors, unicode } for env (process.env by default).
export const detectTerminal = (env = process.env) => ({
	colors: detectColors(env),
	unicode: detectUnicode(env),
});
