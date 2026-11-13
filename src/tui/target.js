// tutuca/tui/target: what a component that renders in a terminal needs to be declared, without
// the terminal: tuiTarget, to pass to enableTargets before component() takes a renders.tui. A
// component without one shows its views in a terminal. tutuca/tui renders them.
import { RenderTarget } from "../core/model/targets.js";

export const tuiTarget = new RenderTarget("tui", { fallsBackToViews: true });
