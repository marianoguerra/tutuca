# Live Systems, Composition & Agent Harnesses

1. **2026-05-11 — [The Proof is in the Universal Frontend](https://www.youtube.com/watch?v=V2aIbzeQY78)**
   A running app can grow at runtime. Components are compiled and registered "just in time", along with their CSS, web components and events. A Component Selector lets them compose without knowing about each other. This is the live host that later agents will extend.

2. **2026-05-22 — [Beyond Read-Write-Bash: A Browser-Native Tutuca Coding Agent](https://www.youtube.com/watch?v=OlqB1l73bDU)**
   The first agent that runs inside the live system instead of against a file system. Its tools are domain-specific: create, lint, test and preview components, plus skills it discovers step by step. They replace read/write/bash.

3. **2026-06-15 — [Domain Specific Agent for Image & Document Manipulation In the Browser](https://www.youtube.com/watch?v=lCa-5CVSjeU)**
   Applies the same browser-native harness idea to another domain. Composed Wasm libraries (ImageMagick, Skia, PDFium) become the agent's tools. It also covers keeping the context small and storing structured data as the agent works.

4. **2026-06-22 — [Beyond Read Write & Bash: SQL & SPARQL as AI Agent Substrate](https://www.youtube.com/watch?v=p9ymiSg0dpg)**
   Structured data becomes the substrate the agent works on. Tools are composed and extended with Aspect-Oriented Programming (AOP) ideas. A hypermedia-style transcript is shared: the agent lowers it for the LLM, and UI components render it.

5. **2026-08-04 — [Hypermedia/AOP inspired Full Stack Domain Specific Coding Agent](https://www.youtube.com/watch?v=ZJOE_EuyRTY)**
   The live system is the harness here. The agent inspects the real DOM, state and handlers. You can point at running context ("put that there") to attach it to a request. Updating a component triggers lints and tests automatically, and the errors go straight back to the agent. The whole stack runs in the browser.

6. **2026-08-10 — [Secure Capability-Based Generative UI with Wasm Components](https://www.youtube.com/watch?v=RoYFUomDwp8)**
   Agent-generated UI is loaded into one running app as sandboxed Wasm components, with no iframes. Capabilities are granted explicitly, so the interface can grow without giving up safety.

7. **2026-08-17 — [Capability-Based Generative UI Protocol over MCP](https://www.youtube.com/watch?v=ZPdQKE1vI-I)**
   Generative UI is exposed as a protocol on top of MCP. Agent clients download safe interactive components on demand (Bluesky, Mastodon and Slack demos). The user approves each side effect.

8. **2026-08-26 — [Just in Time Generative UI Components](https://www.youtube.com/watch?v=dzYvfMRvc9c)**
   Components compile straight to Wasm in memory and start with zero capabilities. The host provides clocks, timers and similar. TutucaScript is a deliberately weak language (no loops, recursion or function calls), so generated logic stays easy to check before it joins the live system.

9. **2026-09-10 — [Vibe and Combine Safe Components Live in the Browser](https://www.youtube.com/watch?v=QIpYLy7IsDA)**
   The agent writes, tests and displays components live, then registers them for reuse. Layout containers combine them into larger UIs. No read/write/bash is involved.

10. **2026-09-10 — [Technical Details of Vibe and Combine Safe Components](https://www.youtube.com/watch?v=S1-Mv49d3T4)**
    Code mode: the agent has a single `run_python` tool over an embedded interpreter, so the harness can inspect the agent's data and show it as interactive components. Components round-trip between source and `.wasm`, which keeps them shareable and composable.

11. **2026-10-20 — [Sync à la Carte: Hot Code Reloading, Persistence, Collaboration](https://www.youtube.com/watch?v=tq_cqi3_h2o)**
    Sync engines plug into running apps: persistence, Automerge, relays. Apps only need schema annotations, no code changes. Liveness (hot reload, shared state) becomes something the system provides, not something each app builds.

12. **2026-10-21 — [The Component [Sync] Expression Problem & How Tutuca Solves It](https://www.youtube.com/watch?v=fGmrPot4hhM)**
    Components and whole apps compose dynamically and recursively at runtime, without glue code, and keep their sync abilities. This is the kind of composition an agent needs in order to assemble systems it didn't write.

13. **2026-10-26 — [Tutuca *in* 6.5K lines of WebAssembly](https://www.youtube.com/watch?v=3zEDjZbVSiI)**
    The runtime is rewritten in Wasm itself. Each component is an isolated module that imports only what the runtime gives it. Composition and sandboxing come together, which is the base for later work on letting untrusted (agent-made) components in.

14. **2026-10-29 — [Safe and Scoped Malleable Systems with Tutuca and Wasm](https://www.youtube.com/watch?v=UQ88xgsIOJo)**
    A malleable live workspace. Scopes limit how far a change or error spreads, components can be shadowed or swapped behind shared interfaces, and `.wasm` components are imported by drag and drop. An AI assistant can generate components into the running system safely.

15. **2026-11-04 — [Visual Interactive Domain Specific Microagents](https://www.youtube.com/watch?v=ll_vT2oDHdE)**
    The exo-harness is introduced. Microagents are self-contained Wasm modules (prompt, skills, tools, UI) whose tools are just messages to their own component tree. A minimal host handles inference and can inspect, meter and block what they do.

16. **2026-11-09 — [Bringing Your Own Components to the Mixed Initiative Canvas](https://www.youtube.com/watch?v=to5SuDeSa0A)**
    Through the Meta-Component Protocol, each component describes how agents should interact with it. A parent agent coordinates per-component sub-agents on a shared canvas where humans and LLMs work together.

17. **2026-11-13 — [One component to render them all](https://www.youtube.com/watch?v=gKP0502_MNk)**
    Renderers are pluggable. One live instance is projected at the same time to the DOM, a terminal UI, generated code, Markdown, an LLM context format and generated LLM tool definitions. An agent calling a tool and a human clicking a button change the same state.

18. **2026-11-20 — [Where You Are is What You Do: Live System as Agent Harness](https://www.youtube.com/watch?v=Ol3Gq5nnsVo)**
    Agents are placed *inside* the live component tree. Their position determines what state, queries and messages they can reach. They can move around the tree, inspect it, and coordinate with other agents. The running system itself is the harness.
