import { component, css, html, rootDispatcher } from "tutuca";
import { produce } from "tutuca/immer";

// Snake, with every rule and every piece of state inside the components.
//
// The only host code is in `getIntentHandlers()` at the bottom: a timer that
// owns a `setInterval` and pushes a `tick` message at the root component, and a
// one-line `focus()` on the board. Neither reads or writes app state —
// `SnakeGame.receive.tick` is what advances the game, so pausing, resuming,
// dying, and changing the speed are all ordinary state transitions the
// component decides on its own.

// Board geometry in SVG user units; the `viewBox` scales it to the container.
const CELL = 20;
const HEAD_FILL = "#22c55e";
const BODY_FILL = "#15803d";

const DELTAS = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] };
const OPPOSITE = { up: "down", down: "up", left: "right", right: "left" };
const KEY_DIRS = {
  ArrowUp: "up",
  ArrowDown: "down",
  ArrowLeft: "left",
  ArrowRight: "right",
  w: "up",
  s: "down",
  a: "left",
  d: "right",
};
const STATUS_LABELS = {
  idle: "Ready",
  running: "Running",
  paused: "Paused",
  over: "Game over",
};

const update = (value, recipe, ...args) =>
  produce(value, (draft) => recipe.call(value, draft, ...args));

// Deterministic PRNG (mulberry32). Food placement is a pure function of the
// `seed` field, so `step()` stays testable — no `Math.random()` in a handler.
function nextRandom(seed) {
  const next = (seed + 0x6d2b79f5) | 0;
  let t = next;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return [(t ^ (t >>> 14)) >>> 0, next];
}

// A board coordinate. Its own view is a coordinate badge, so it renders on its
// own in the storybook; the board draws cells with `@each` + `@enrich-with`.
export const Cell = component({
  name: "Cell",
  fields: { x: 0, y: 0 },
  methods: {
    label() {
      return `(${this.x}, ${this.y})`;
    },
    isAt(other) {
      return this.x === other.x && this.y === other.y;
    },
    movedBy(dx, dy) {
      return Cell.make({ x: this.x + dx, y: this.y + dy });
    },
    isOutside(cols, rows) {
      return this.x < 0 || this.y < 0 || this.x >= cols || this.y >= rows;
    },
  },
  view: html`<code class="badge badge-ghost font-mono" @text="$label"></code>`,
});

export const SnakeGame = component({
  name: "SnakeGame",
  // The emoji arrows are square icon buttons: `.btn` sizes itself around a text
  // label, which leaves an emoji off-center and cramped, so give the pad its own
  // fixed square cells and center the glyph in them.
  style: css`
    .dpad {
      display: flex;
      gap: 0.25rem;
    }
    .dpad button {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 2.25rem;
      height: 2.25rem;
      padding: 0;
      font-size: 1.125rem;
      line-height: 1;
    }
  `,
  fields: {
    cols: 24,
    rows: 16,
    // head first, tail last
    snake: [Cell.make({ x: 3, y: 8 }), Cell.make({ x: 2, y: 8 }), Cell.make({ x: 1, y: 8 })],
    food: Cell.make({ x: 12, y: 8 }),
    dir: "right", // the direction the last tick moved in
    pendingDir: "right", // what the next tick will use (set by the controls)
    status: "idle", // idle | running | paused | over
    score: 0,
    ticks: 0,
    intervalMs: 160,
    seed: 1,
  },
  methods: {
    // --- derived values for the view ---
    boardWidth() {
      return this.cols * CELL;
    },
    boardHeight() {
      return this.rows * CELL;
    },
    viewBox() {
      return `0 0 ${this.boardWidth()} ${this.boardHeight()}`;
    },
    centerX() {
      return this.boardWidth() / 2;
    },
    centerY() {
      return this.boardHeight() / 2;
    },
    foodX() {
      return this.food.x * CELL + 3;
    },
    foodY() {
      return this.food.y * CELL + 3;
    },
    foodSide() {
      return CELL - 6;
    },
    isIdle() {
      return this.status === "idle";
    },
    isRunning() {
      return this.status === "running";
    },
    isPaused() {
      return this.status === "paused";
    },
    isOver() {
      return this.status === "over";
    },
    statusLabel() {
      return STATUS_LABELS[this.status];
    },
    scoreLabel() {
      return `Score ${this.score}`;
    },
    speedLabel() {
      return `${this.intervalMs} ms per tick`;
    },
    tickLabel() {
      return `${this.ticks} ticks · ${this.snake.length} long`;
    },

    // --- game rules: pure, no ctx, no side effects ---
    head() {
      return this.snake[0];
    },
    hasSnakeAt(x, y) {
      return this.snake.some((cell) => cell.x === x && cell.y === y);
    },
    nextHead() {
      const [dx, dy] = DELTAS[this.pendingDir];
      return this.head().movedBy(dx, dy);
    },
    // Move the food to a random free cell and advance the seed. With no free
    // cell left the board is full: the run is over.

    // A fresh idle board, keeping the current speed and carrying the seed
    // forward so a replay lays out different food.

    // Queue a turn. A 180° reversal would run the snake into its own neck, so
    // it is ignored; comparing against `dir` (not `pendingDir`) means two turns
    // within one tick can't sneak a reversal through.

    // One tick of the world: move, maybe eat, maybe die.

    // --- transitions that (re)schedule the outside timer ---
    // Starting and resuming from a button leaves the focus on that button, so
    // both ask the host to put it back on the board and the keys work right away.
  },
  alter: {
    // per snake segment: grid coordinates to pixels, head in a lighter green
    segment(binds, key, cell) {
      binds.x = cell.x * CELL + 1;
      binds.y = cell.y * CELL + 1;
      binds.side = CELL - 2;
      binds.fill = key === 0 ? HEAD_FILL : BODY_FILL;
    },
  },
  receive: {
    placeFood(draft) {
      const free = [];
      for (let y = 0; y < draft.rows; y++)
        for (let x = 0; x < draft.cols; x++)
          if (!draft.snake.some((cell) => cell.x === x && cell.y === y)) free.push([x, y]);
      if (free.length === 0) {
        draft.status = "over";
        return;
      }
      const [n, seed] = nextRandom(draft.seed);
      const [x, y] = free[n % free.length];
      draft.food = Cell.make({ x, y });
      draft.seed = seed;
    },
    reset(draft) {
      const y = Math.floor(draft.rows / 2);
      draft.snake = [Cell.make({ x: 3, y }), Cell.make({ x: 2, y }), Cell.make({ x: 1, y })];
      draft.dir = "right";
      draft.pendingDir = "right";
      draft.score = 0;
      draft.ticks = 0;
      draft.status = "idle";
      SnakeGame.receive.placeFood.call(this, draft);
    },
    turn(draft, dir) {
      if (!dir || dir === this.dir || dir === OPPOSITE[this.dir]) return this;
      draft.pendingDir = dir;
    },
    step(draft) {
      if (!this.isRunning()) return this;
      const [dx, dy] = DELTAS[draft.pendingDir];
      const currentHead = draft.snake[0];
      const head = Cell.make({ x: currentHead.x + dx, y: currentHead.y + dy });
      if (head.isOutside(draft.cols, draft.rows)) {
        draft.status = "over";
        return;
      }
      const ate = head.isAt(draft.food);
      const snake = [head, ...draft.snake];
      // Not eating means the tail vacates its cell on this same tick, so it is
      // dropped before the self-collision check.
      if (!ate) snake.pop();
      if (snake.slice(1).some((cell) => cell.isAt(head))) {
        draft.status = "over";
        return;
      }
      draft.snake = snake;
      draft.dir = draft.pendingDir;
      draft.ticks++;
      if (ate) {
        draft.score++;
        SnakeGame.receive.placeFood.call(this, draft);
      }
    },
    startGame(draft, ctx) {
      SnakeGame.receive.reset.call(this, draft);
      draft.status = "running";
      ctx.intent("startTicking", [draft.intervalMs], { route: ["lex"] });
      ctx.intent("focusBoard", [], { route: ["lex"] });
    },
    pauseGame(draft, ctx) {
      if (!this.isRunning()) return this;
      ctx.intent("stopTicking", [], { route: ["lex"] });
      draft.status = "paused";
    },
    resumeGame(draft, ctx) {
      if (!this.isPaused()) return this;
      ctx.intent("startTicking", [this.intervalMs], { route: ["lex"] });
      ctx.intent("focusBoard", [], { route: ["lex"] });
      draft.status = "running";
    },
    togglePause(draft, ctx) {
      if (this.isRunning()) return SnakeGame.receive.pauseGame.call(this, draft, ctx);
      if (this.isPaused()) return SnakeGame.receive.resumeGame.call(this, draft, ctx);
      return this;
    },

    turnUp(draft) {
      SnakeGame.receive.turn.call(this, draft, "up");
    },
    turnDown(draft) {
      SnakeGame.receive.turn.call(this, draft, "down");
    },
    turnLeft(draft) {
      SnakeGame.receive.turn.call(this, draft, "left");
    },
    turnRight(draft) {
      SnakeGame.receive.turn.call(this, draft, "right");
    },
    onKeyDown(draft, key, ctx) {
      if (key === " " || key === "p") SnakeGame.receive.togglePause.call(this, draft, ctx);
      else
        SnakeGame.receive.turn.call(
          this,
          draft,
          KEY_DIRS[key.length === 1 ? key.toLowerCase() : key],
        );
    },
    // while dragging the slider: show the new speed without touching the timer
    previewSpeed(draft, ms) {
      draft.intervalMs = ms;
    },
    // on release: a running game restarts its interval at the new rate
    applySpeed(draft, ms, ctx) {
      draft.intervalMs = ms;
      if (this.isRunning()) ctx.intent("startTicking", [ms], { route: ["lex"] });
    },
    // dispatched by the host after `app.start()` (`app.sendAtRoot("init")`)
    init(draft) {
      SnakeGame.receive.reset.call(this, draft);
    },
    // the message from the outside world, once per interval
    tick(draft, ctx) {
      if (!this.isRunning()) return this; // a tick that raced a pause: ignore it
      SnakeGame.receive.step.call(this, draft);
      if (draft.status === "over") ctx.intent("stopTicking", [], { route: ["lex"] });
    },
  },
  view: html`<section class="flex flex-col gap-3">
    <div class="flex flex-wrap items-center gap-2">
      <span class="badge badge-lg badge-primary" @text="$scoreLabel"></span>
      <span class="badge badge-lg" @text="$statusLabel"></span>
      <span class="text-sm opacity-60" @text="$tickLabel"></span>
    </div>

    <div class="snake-board" tabindex="0" @on.keydown="onKeyDown key">
      <svg
        :viewBox="$viewBox"
        style="width:100%;max-height:55vh"
        role="img"
        aria-label="Snake board"
      >
        <rect x="0" y="0" :width="$boardWidth" :height="$boardHeight" rx="6" fill="#0f172a"></rect>
        <rect
          :x="$foodX"
          :y="$foodY"
          :width="$foodSide"
          :height="$foodSide"
          rx="5"
          fill="#f97316"
        ></rect>
        <rect
          @each=".snake"
          @enrich-with="segment"
          :x="@x"
          :y="@y"
          :width="@side"
          :height="@side"
          rx="3"
          :fill="@fill"
        ></rect>
        <text
          @show="$isOver"
          :x="$centerX"
          :y="$centerY"
          text-anchor="middle"
          font-size="28"
          font-weight="bold"
          fill="#f8fafc"
        >
          Game over
        </text>
        <text
          @show="$isPaused"
          :x="$centerX"
          :y="$centerY"
          text-anchor="middle"
          font-size="28"
          font-weight="bold"
          fill="#f8fafc"
        >
          Paused
        </text>
      </svg>
    </div>

    <div class="flex flex-wrap items-center gap-3">
      <div class="join">
        <button class="btn btn-primary join-item" @hide="$isRunning" @on.click="startGame">
          New game
        </button>
        <button class="btn join-item" @show="$isRunning" @on.click="pauseGame">Pause</button>
        <button class="btn btn-success join-item" @show="$isPaused" @on.click="resumeGame">
          Resume
        </button>
      </div>
      <div class="dpad">
        <button class="btn btn-sm" aria-label="Turn left" @on.click="turnLeft">⬅️</button>
        <button class="btn btn-sm" aria-label="Turn up" @on.click="turnUp">⬆️</button>
        <button class="btn btn-sm" aria-label="Turn down" @on.click="turnDown">⬇️</button>
        <button class="btn btn-sm" aria-label="Turn right" @on.click="turnRight">➡️</button>
      </div>
    </div>

    <label class="flex flex-wrap items-center gap-3">
      <span class="text-sm">Tick every</span>
      <input
        type="range"
        min="60"
        max="500"
        step="20"
        :value=".intervalMs"
        @on.input="previewSpeed valueAsInt"
        @on.change="applySpeed valueAsInt"
      />
      <span class="text-sm font-mono" @text="$speedLabel"></span>
    </label>

    <p class="text-sm opacity-60">
      New game and Resume focus the board, so you can steer straight away with the arrow keys or
      <code class="font-mono">WASD</code>; space pauses and resumes. Click the board to get the
      focus back, or use the arrow buttons, which work without it.
    </p>
  </section>`,
});

export function getComponents() {
  return [SnakeGame, Cell];
}

export function getRoot() {
  return SnakeGame.make({});
}

// The whole "outside" of this example: one timer, and one message.
//
// A real app writes this as host glue next to `app.start()`:
//
//   let id = null;
//   handlers.startTicking = (ms) => { clearInterval(id); id = setInterval(() => app.sendAtRoot("tick"), ms); };
//
// An example module never sees the `app` (the playground, `show.html`, the
// storybook and the CLI all mount it themselves), so the timer lives in a
// request handler instead and reaches the root through `rootDispatcher`, which
// is exactly what `app.sendAtRoot` does: dispatch `tick` at the root path.
let stopPreviousTimer = null;

export function getIntentHandlers() {
  // Each mount gets its own handlers; drop the timer the previous mount left
  // running (the playground re-runs the module on every edit).
  stopPreviousTimer?.();
  let timerId = null;
  const stop = () => {
    if (timerId !== null) clearInterval(timerId);
    timerId = null;
  };
  stopPreviousTimer = stop;
  return {
    async startTicking(intervalMs, ctx) {
      stop();
      const root = rootDispatcher(ctx.transactor);
      timerId = setInterval(() => root.send("tick", []), intervalMs);
    },
    async stopTicking() {
      stop();
    },
    // The other thing only the outside can do: move the focus. A handler gets no
    // DOM node, so it looks the board up by class — with more than one game on
    // the page (the storybook gallery) the first one wins, which is fine here.
    async focusBoard() {
      globalThis.document?.querySelector(".snake-board")?.focus();
    },
  };
}

export function getExamples() {
  const running = SnakeGame.make({ status: "running", score: 3, ticks: 42 });
  return [
    {
      title: "Snake",
      description: "A game whose whole state machine lives in the components",
      items: [
        {
          title: "Ready",
          description: "Idle board, waiting for New game",
          value: SnakeGame.make({}),
        },
        {
          title: "Running",
          description: "Mid-run: a longer snake and a score",
          value: produce(running, (draft) => {
            draft.snake = [
              Cell.make({ x: 8, y: 8 }),
              Cell.make({ x: 7, y: 8 }),
              Cell.make({ x: 6, y: 8 }),
              Cell.make({ x: 5, y: 8 }),
              Cell.make({ x: 5, y: 9 }),
              Cell.make({ x: 5, y: 10 }),
            ];
          }),
        },
        {
          title: "Paused",
          description: "The tick is cancelled; the board keeps its state",
          value: produce(running, (draft) => {
            draft.status = "paused";
          }),
        },
        {
          title: "Game over",
          description: "Ran into the wall",
          value: produce(running, (draft) => {
            draft.status = "over";
          }),
        },
        {
          title: "Slow ticks",
          description: "The interval is configured from the game UI",
          value: SnakeGame.make({ intervalMs: 480 }),
        },
      ],
    },
    {
      title: "Cell",
      description: "A board coordinate",
      items: [
        { title: "Origin", description: "Top-left cell", value: Cell.make({}) },
        { title: "Somewhere", description: "A cell further in", value: Cell.make({ x: 7, y: 4 }) },
      ],
    },
  ];
}

export function getTests({ describe, test, expect }) {
  // handlers that schedule the timer only need a ctx that records the intents raised
  const recordingCtx = () => {
    const intents = [];
    return { intents, intent: (name, args) => intents.push({ name, args }) };
  };
  const running = (fields) => SnakeGame.make({ status: "running", ...fields });

  describe(Cell, () => {
    test("isAt compares coordinates", () => {
      expect(Cell.make({ x: 2, y: 3 }).isAt(Cell.make({ x: 2, y: 3 }))).toBe(true);
      expect(Cell.make({ x: 2, y: 3 }).isAt(Cell.make({ x: 3, y: 2 }))).toBe(false);
    });
    test("movedBy returns a new cell", () => {
      const cell = Cell.make({ x: 2, y: 3 });
      expect(cell.movedBy(1, -1).label()).toBe("(3, 2)");
      expect(cell.x).toBe(2);
    });
    test("isOutside detects every wall", () => {
      expect(Cell.make({ x: -1, y: 0 }).isOutside(4, 4)).toBe(true);
      expect(Cell.make({ x: 0, y: -1 }).isOutside(4, 4)).toBe(true);
      expect(Cell.make({ x: 4, y: 0 }).isOutside(4, 4)).toBe(true);
      expect(Cell.make({ x: 0, y: 4 }).isOutside(4, 4)).toBe(true);
      expect(Cell.make({ x: 3, y: 3 }).isOutside(4, 4)).toBe(false);
    });
  });

  describe(SnakeGame, () => {
    describe("step()", () => {
      test("moves the head in the pending direction and drags the tail", () => {
        const game = running();
        const next = update(game, SnakeGame.receive.step);
        expect(next.head().label()).toBe("(4, 8)");
        expect(next.snake.length).toBe(3);
        expect(next.ticks).toBe(1);
      });
      test("does nothing unless the game is running", () => {
        const idle = SnakeGame.make({});
        expect(update(idle, SnakeGame.receive.step)).toBe(idle);
        const paused = SnakeGame.make({ status: "paused" });
        expect(update(paused, SnakeGame.receive.step).ticks).toBe(0);
      });
      test("eating grows the snake, scores, and moves the food", () => {
        const game = running({ food: Cell.make({ x: 4, y: 8 }) });
        const next = update(game, SnakeGame.receive.step);
        expect(next.snake.length).toBe(4);
        expect(next.score).toBe(1);
        expect(next.food.isAt(Cell.make({ x: 4, y: 8 }))).toBe(false);
      });
      test("hitting a wall ends the game", () => {
        const game = running({
          snake: [Cell.make({ x: 23, y: 8 })],
          pendingDir: "right",
        });
        expect(update(game, SnakeGame.receive.step).status).toBe("over");
      });
      test("biting itself ends the game", () => {
        // a 4-long snake curled so that turning down lands on its own body
        const game = running({
          snake: [
            Cell.make({ x: 5, y: 5 }),
            Cell.make({ x: 4, y: 5 }),
            Cell.make({ x: 4, y: 6 }),
            Cell.make({ x: 5, y: 6 }),
            Cell.make({ x: 6, y: 6 }),
          ],
          dir: "right",
          pendingDir: "down",
        });
        expect(update(game, SnakeGame.receive.step).status).toBe("over");
      });
      test("the vacated tail cell is not a collision", () => {
        const game = running({
          snake: [
            Cell.make({ x: 5, y: 5 }),
            Cell.make({ x: 4, y: 5 }),
            Cell.make({ x: 4, y: 6 }),
            Cell.make({ x: 5, y: 6 }),
          ],
          dir: "right",
          pendingDir: "down",
        });
        expect(update(game, SnakeGame.receive.step).status).toBe("running");
      });
      test("does not mutate the original instance", () => {
        const game = running();
        update(game, SnakeGame.receive.step);
        expect(game.ticks).toBe(0);
      });
    });

    describe("turn()", () => {
      test("queues the new direction", () => {
        const game = running();
        expect(update(game, SnakeGame.receive.turn, "up").pendingDir).toBe("up");
      });
      test("ignores a reversal", () => {
        const game = running();
        expect(update(game, SnakeGame.receive.turn, "left")).toBe(game);
      });
      test("ignores a reversal queued in two steps within one tick", () => {
        // right -> up is fine, up -> left would still be a legal move next tick,
        // but right -> up -> down must not become a reversal of `dir`
        const game = running();
        const next = produce(game, (draft) => {
          SnakeGame.receive.turn.call(game, draft, "up");
          SnakeGame.receive.turn.call(game, draft, "left");
        });
        expect(next.pendingDir).toBe("up");
      });
      test("ignores an unknown key", () => {
        const game = running();
        expect(update(game, SnakeGame.receive.turn, undefined)).toBe(game);
      });
    });

    describe("placeFood()", () => {
      test("never lands on the snake and advances the seed", () => {
        const initial = SnakeGame.make({});
        const game = update(initial, SnakeGame.receive.placeFood);
        expect(game.hasSnakeAt(game.food.x, game.food.y)).toBe(false);
        expect(game.seed).not.toBe(SnakeGame.make({}).seed);
      });
      test("is deterministic for a given seed", () => {
        const av = SnakeGame.make({ seed: 7 });
        const bv = SnakeGame.make({ seed: 7 });
        const a = update(av, SnakeGame.receive.placeFood);
        const b = update(bv, SnakeGame.receive.placeFood);
        expect(a.food.label()).toBe(b.food.label());
      });
      test("a full board ends the game", () => {
        const snake = [];
        for (let y = 0; y < 2; y++) for (let x = 0; x < 2; x++) snake.push(Cell.make({ x, y }));
        const game = SnakeGame.make({ cols: 2, rows: 2, snake });
        expect(update(game, SnakeGame.receive.placeFood).status).toBe("over");
      });
    });

    describe("the outside timer", () => {
      test("startGame resets the board and asks for ticks", () => {
        const ctx = recordingCtx();
        const game = SnakeGame.make({ score: 9, ticks: 5 });
        const next = update(game, SnakeGame.receive.startGame, ctx);
        expect(next.status).toBe("running");
        expect(next.score).toBe(0);
        expect(ctx.intents).toEqual([
          { name: "startTicking", args: [160] },
          { name: "focusBoard", args: [] },
        ]);
      });
      test("pauseGame cancels the tick", () => {
        const ctx = recordingCtx();
        const game = running();
        const next = update(game, SnakeGame.receive.pauseGame, ctx);
        expect(next.status).toBe("paused");
        expect(ctx.intents).toEqual([{ name: "stopTicking", args: [] }]);
      });
      test("pauseGame is a no-op unless the game is running", () => {
        const ctx = recordingCtx();
        const game = SnakeGame.make({});
        expect(update(game, SnakeGame.receive.pauseGame, ctx)).toBe(game);
        expect(ctx.intents).toEqual([]);
      });
      test("resumeGame starts it again", () => {
        const ctx = recordingCtx();
        const game = SnakeGame.make({ status: "paused", intervalMs: 300 });
        const next = update(game, SnakeGame.receive.resumeGame, ctx);
        expect(next.status).toBe("running");
        expect(ctx.intents).toEqual([
          { name: "startTicking", args: [300] },
          { name: "focusBoard", args: [] },
        ]);
      });
      test("togglePause round-trips", () => {
        const ctx = recordingCtx();
        const game = running();
        const next = update(
          update(game, SnakeGame.receive.togglePause, ctx),
          SnakeGame.receive.togglePause,
          ctx,
        );
        expect(next.status).toBe("running");
      });
      test("applySpeed reschedules a running game at the new rate", () => {
        const ctx = recordingCtx();
        const game = running();
        const next = update(game, SnakeGame.receive.applySpeed, 320, ctx);
        expect(next.intervalMs).toBe(320);
        expect(ctx.intents).toEqual([{ name: "startTicking", args: [320] }]);
      });
      test("applySpeed on a paused game only stores the rate", () => {
        const ctx = recordingCtx();
        const game = SnakeGame.make({});
        const next = update(game, SnakeGame.receive.applySpeed, 320, ctx);
        expect(next.intervalMs).toBe(320);
        expect(ctx.intents).toEqual([]);
      });
      test("previewSpeed never touches the timer", () => {
        const game = running();
        expect(update(game, SnakeGame.receive.previewSpeed, 100).intervalMs).toBe(100);
      });
    });

    describe("receive.tick", () => {
      test("advances the game", () => {
        const ctx = recordingCtx();
        const game = running();
        const next = update(game, SnakeGame.receive.tick, ctx);
        expect(next.ticks).toBe(1);
        expect(ctx.intents).toEqual([]);
      });
      test("a tick that arrives while paused is ignored", () => {
        const ctx = recordingCtx();
        const paused = SnakeGame.make({ status: "paused" });
        expect(update(paused, SnakeGame.receive.tick, ctx)).toBe(paused);
      });
      test("a fatal tick cancels the outside timer", () => {
        const ctx = recordingCtx();
        const game = running({ snake: [Cell.make({ x: 23, y: 8 })] });
        const next = update(game, SnakeGame.receive.tick, ctx);
        expect(next.status).toBe("over");
        expect(ctx.intents).toEqual([{ name: "stopTicking", args: [] }]);
      });
    });

    describe("input.onKeyDown", () => {
      test("maps arrows and WASD to turns", () => {
        const ctx = recordingCtx();
        expect(update(running(), SnakeGame.receive.onKeyDown, "ArrowUp", ctx).pendingDir).toBe(
          "up",
        );
        expect(update(running(), SnakeGame.receive.onKeyDown, "s", ctx).pendingDir).toBe("down");
        expect(update(running(), SnakeGame.receive.onKeyDown, "W", ctx).pendingDir).toBe("up");
      });
      test("space toggles the pause", () => {
        const ctx = recordingCtx();
        const game = running();
        const next = update(game, SnakeGame.receive.onKeyDown, " ", ctx);
        expect(next.status).toBe("paused");
        expect(ctx.intents).toEqual([{ name: "stopTicking", args: [] }]);
      });
      test("any other key leaves the game alone", () => {
        const ctx = recordingCtx();
        const game = running();
        expect(update(game, SnakeGame.receive.onKeyDown, "q", ctx)).toBe(game);
      });
    });

    describe("alter.segment", () => {
      test("turns grid coordinates into pixels and colors the head", () => {
        const binds = {};
        SnakeGame.alter.segment.call(running(), binds, 0, Cell.make({ x: 2, y: 3 }));
        expect(binds.x).toBe(41);
        expect(binds.y).toBe(61);
        expect(binds.fill).toBe(HEAD_FILL);
      });
      test("body segments use the darker fill", () => {
        const binds = {};
        SnakeGame.alter.segment.call(running(), binds, 1, Cell.make({ x: 0, y: 0 }));
        expect(binds.fill).toBe(BODY_FILL);
      });
    });
  });
}
