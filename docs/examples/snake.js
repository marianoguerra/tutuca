import { component, css, html, rootDispatcher } from "tutuca";

// Snake, with every rule and every piece of state inside the components.
//
// The only host code is the timer in `getRequestHandlers()` at the bottom: it
// owns a `setInterval` and pushes a `tick` message at the root component. It
// never reads or writes app state — `SnakeGame.receive.tick` is what advances
// the game, so pausing, resuming, dying, and changing the speed are all
// ordinary state transitions the component decides on its own.

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
      return this.setX(this.x + dx).setY(this.y + dy);
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
      return `${this.ticks} ticks · ${this.snake.size} long`;
    },

    // --- game rules: pure, no ctx, no side effects ---
    head() {
      return this.snake.first();
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
    placeFood() {
      const free = [];
      for (let y = 0; y < this.rows; y++)
        for (let x = 0; x < this.cols; x++) if (!this.hasSnakeAt(x, y)) free.push([x, y]);
      if (free.length === 0) return this.setStatus("over");
      const [n, seed] = nextRandom(this.seed);
      const [x, y] = free[n % free.length];
      return this.setFood(Cell.make({ x, y })).setSeed(seed);
    },
    // A fresh idle board, keeping the current speed and carrying the seed
    // forward so a replay lays out different food.
    reset() {
      const y = Math.floor(this.rows / 2);
      return this.setSnake([Cell.make({ x: 3, y }), Cell.make({ x: 2, y }), Cell.make({ x: 1, y })])
        .setDir("right")
        .setPendingDir("right")
        .setScore(0)
        .setTicks(0)
        .setStatus("idle")
        .placeFood();
    },
    // Queue a turn. A 180° reversal would run the snake into its own neck, so
    // it is ignored; comparing against `dir` (not `pendingDir`) means two turns
    // within one tick can't sneak a reversal through.
    turn(dir) {
      if (!dir || dir === this.dir || dir === OPPOSITE[this.dir]) return this;
      return this.setPendingDir(dir);
    },
    // One tick of the world: move, maybe eat, maybe die.
    step() {
      if (!this.isRunning()) return this;
      const head = this.nextHead();
      if (head.isOutside(this.cols, this.rows)) return this.setStatus("over");
      const ate = head.isAt(this.food);
      const grown = this.snake.unshift(head);
      // Not eating means the tail vacates its cell on this same tick, so it is
      // dropped before the self-collision check.
      const snake = ate ? grown : grown.pop();
      if (snake.rest().some((cell) => cell.isAt(head))) return this.setStatus("over");
      const moved = this.setSnake(snake)
        .setDir(this.pendingDir)
        .setTicks(this.ticks + 1);
      return ate ? moved.setScore(this.score + 1).placeFood() : moved;
    },

    // --- transitions that (re)schedule the outside timer ---
    startGame(ctx) {
      const next = this.reset().setStatus("running");
      ctx.request("startTicking", [next.intervalMs]);
      return next;
    },
    pauseGame(ctx) {
      if (!this.isRunning()) return this;
      ctx.request("stopTicking", []);
      return this.setStatus("paused");
    },
    resumeGame(ctx) {
      if (!this.isPaused()) return this;
      ctx.request("startTicking", [this.intervalMs]);
      return this.setStatus("running");
    },
    togglePause(ctx) {
      if (this.isRunning()) return this.pauseGame(ctx);
      if (this.isPaused()) return this.resumeGame(ctx);
      return this;
    },
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
  input: {
    turnUp() {
      return this.turn("up");
    },
    turnDown() {
      return this.turn("down");
    },
    turnLeft() {
      return this.turn("left");
    },
    turnRight() {
      return this.turn("right");
    },
    onKeyDown(key, ctx) {
      if (key === " " || key === "p") return this.togglePause(ctx);
      return this.turn(KEY_DIRS[key.length === 1 ? key.toLowerCase() : key]);
    },
    // while dragging the slider: show the new speed without touching the timer
    previewSpeed(ms) {
      return this.setIntervalMs(ms);
    },
    // on release: a running game restarts its interval at the new rate
    applySpeed(ms, ctx) {
      const next = this.setIntervalMs(ms);
      if (next.isRunning()) ctx.request("startTicking", [ms]);
      return next;
    },
  },
  receive: {
    // dispatched by the host after `app.start()` (`app.sendAtRoot("init")`)
    init() {
      return this.reset();
    },
    // the message from the outside world, once per interval
    tick(ctx) {
      if (!this.isRunning()) return this; // a tick that raced a pause: ignore it
      const next = this.step();
      if (next.isOver()) ctx.request("stopTicking", []);
      return next;
    },
  },
  view: html`<section class="flex flex-col gap-3">
    <div class="flex flex-wrap items-center gap-2">
      <span class="badge badge-lg badge-primary" @text="$scoreLabel"></span>
      <span class="badge badge-lg" @text="$statusLabel"></span>
      <span class="text-sm opacity-60" @text="$tickLabel"></span>
    </div>

    <div tabindex="0" @on.keydown="onKeyDown key">
      <svg
        :viewBox="$viewBox"
        style="width:100%;max-height:55vh"
        role="img"
        aria-label="Snake board"
      >
        <rect
          x="0"
          y="0"
          :width="$boardWidth"
          :height="$boardHeight"
          rx="6"
          fill="#0f172a"
        ></rect>
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
        <button class="btn btn-primary join-item" @hide="$isRunning" @on.click="$startGame">
          New game
        </button>
        <button class="btn join-item" @show="$isRunning" @on.click="$pauseGame">Pause</button>
        <button class="btn btn-success join-item" @show="$isPaused" @on.click="$resumeGame">
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
      Click the board to focus it, then steer with the arrow keys or
      <code class="font-mono">WASD</code>; space pauses and resumes. The arrow
      buttons work without focus.
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

export function getRequestHandlers() {
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
          value: running.setSnake([
            Cell.make({ x: 8, y: 8 }),
            Cell.make({ x: 7, y: 8 }),
            Cell.make({ x: 6, y: 8 }),
            Cell.make({ x: 5, y: 8 }),
            Cell.make({ x: 5, y: 9 }),
            Cell.make({ x: 5, y: 10 }),
          ]),
        },
        {
          title: "Paused",
          description: "The tick is cancelled; the board keeps its state",
          value: running.setStatus("paused"),
        },
        {
          title: "Game over",
          description: "Ran into the wall",
          value: running.setStatus("over"),
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
  // handlers that schedule the timer only need a ctx that records requests
  const recordingCtx = () => {
    const requests = [];
    return { requests, request: (name, args) => requests.push({ name, args }) };
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
        const next = running().step();
        expect(next.head().label()).toBe("(4, 8)");
        expect(next.snake.size).toBe(3);
        expect(next.ticks).toBe(1);
      });
      test("does nothing unless the game is running", () => {
        const idle = SnakeGame.make({});
        expect(idle.step()).toBe(idle);
        expect(SnakeGame.make({ status: "paused" }).step().ticks).toBe(0);
      });
      test("eating grows the snake, scores, and moves the food", () => {
        const game = running({ food: Cell.make({ x: 4, y: 8 }) });
        const next = game.step();
        expect(next.snake.size).toBe(4);
        expect(next.score).toBe(1);
        expect(next.food.isAt(Cell.make({ x: 4, y: 8 }))).toBe(false);
      });
      test("hitting a wall ends the game", () => {
        const game = running({
          snake: [Cell.make({ x: 23, y: 8 })],
          pendingDir: "right",
        });
        expect(game.step().status).toBe("over");
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
        expect(game.step().status).toBe("over");
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
        expect(game.step().status).toBe("running");
      });
      test("does not mutate the original instance", () => {
        const game = running();
        game.step();
        expect(game.ticks).toBe(0);
      });
    });

    describe("turn()", () => {
      test("queues the new direction", () => {
        expect(running().turn("up").pendingDir).toBe("up");
      });
      test("ignores a reversal", () => {
        const game = running();
        expect(game.turn("left")).toBe(game);
      });
      test("ignores a reversal queued in two steps within one tick", () => {
        // right -> up is fine, up -> left would still be a legal move next tick,
        // but right -> up -> down must not become a reversal of `dir`
        expect(running().turn("up").turn("left").pendingDir).toBe("up");
      });
      test("ignores an unknown key", () => {
        const game = running();
        expect(game.turn(undefined)).toBe(game);
      });
    });

    describe("placeFood()", () => {
      test("never lands on the snake and advances the seed", () => {
        const game = SnakeGame.make({}).placeFood();
        expect(game.hasSnakeAt(game.food.x, game.food.y)).toBe(false);
        expect(game.seed).not.toBe(SnakeGame.make({}).seed);
      });
      test("is deterministic for a given seed", () => {
        const a = SnakeGame.make({ seed: 7 }).placeFood();
        const b = SnakeGame.make({ seed: 7 }).placeFood();
        expect(a.food.label()).toBe(b.food.label());
      });
      test("a full board ends the game", () => {
        const snake = [];
        for (let y = 0; y < 2; y++) for (let x = 0; x < 2; x++) snake.push(Cell.make({ x, y }));
        expect(SnakeGame.make({ cols: 2, rows: 2, snake }).placeFood().status).toBe("over");
      });
    });

    describe("the outside timer", () => {
      test("startGame resets the board and asks for ticks", () => {
        const ctx = recordingCtx();
        const next = SnakeGame.make({ score: 9, ticks: 5 }).startGame(ctx);
        expect(next.status).toBe("running");
        expect(next.score).toBe(0);
        expect(ctx.requests).toEqual([{ name: "startTicking", args: [160] }]);
      });
      test("pauseGame cancels the tick", () => {
        const ctx = recordingCtx();
        const next = running().pauseGame(ctx);
        expect(next.status).toBe("paused");
        expect(ctx.requests).toEqual([{ name: "stopTicking", args: [] }]);
      });
      test("pauseGame is a no-op unless the game is running", () => {
        const ctx = recordingCtx();
        const game = SnakeGame.make({});
        expect(game.pauseGame(ctx)).toBe(game);
        expect(ctx.requests).toEqual([]);
      });
      test("resumeGame starts it again", () => {
        const ctx = recordingCtx();
        const next = SnakeGame.make({ status: "paused", intervalMs: 300 }).resumeGame(ctx);
        expect(next.status).toBe("running");
        expect(ctx.requests).toEqual([{ name: "startTicking", args: [300] }]);
      });
      test("togglePause round-trips", () => {
        const ctx = recordingCtx();
        expect(running().togglePause(ctx).togglePause(ctx).status).toBe("running");
      });
      test("applySpeed reschedules a running game at the new rate", () => {
        const ctx = recordingCtx();
        const next = SnakeGame.input.applySpeed.call(running(), 320, ctx);
        expect(next.intervalMs).toBe(320);
        expect(ctx.requests).toEqual([{ name: "startTicking", args: [320] }]);
      });
      test("applySpeed on a paused game only stores the rate", () => {
        const ctx = recordingCtx();
        const next = SnakeGame.input.applySpeed.call(SnakeGame.make({}), 320, ctx);
        expect(next.intervalMs).toBe(320);
        expect(ctx.requests).toEqual([]);
      });
      test("previewSpeed never touches the timer", () => {
        expect(SnakeGame.input.previewSpeed.call(running(), 100).intervalMs).toBe(100);
      });
    });

    describe("receive.tick", () => {
      test("advances the game", () => {
        const ctx = recordingCtx();
        const next = SnakeGame.receive.tick.call(running(), ctx);
        expect(next.ticks).toBe(1);
        expect(ctx.requests).toEqual([]);
      });
      test("a tick that arrives while paused is ignored", () => {
        const ctx = recordingCtx();
        const paused = SnakeGame.make({ status: "paused" });
        expect(SnakeGame.receive.tick.call(paused, ctx)).toBe(paused);
      });
      test("a fatal tick cancels the outside timer", () => {
        const ctx = recordingCtx();
        const game = running({ snake: [Cell.make({ x: 23, y: 8 })] });
        const next = SnakeGame.receive.tick.call(game, ctx);
        expect(next.status).toBe("over");
        expect(ctx.requests).toEqual([{ name: "stopTicking", args: [] }]);
      });
    });

    describe("input.onKeyDown", () => {
      test("maps arrows and WASD to turns", () => {
        const ctx = recordingCtx();
        expect(SnakeGame.input.onKeyDown.call(running(), "ArrowUp", ctx).pendingDir).toBe("up");
        expect(SnakeGame.input.onKeyDown.call(running(), "s", ctx).pendingDir).toBe("down");
        expect(SnakeGame.input.onKeyDown.call(running(), "W", ctx).pendingDir).toBe("up");
      });
      test("space toggles the pause", () => {
        const ctx = recordingCtx();
        const next = SnakeGame.input.onKeyDown.call(running(), " ", ctx);
        expect(next.status).toBe("paused");
        expect(ctx.requests).toEqual([{ name: "stopTicking", args: [] }]);
      });
      test("any other key leaves the game alone", () => {
        const ctx = recordingCtx();
        const game = running();
        expect(SnakeGame.input.onKeyDown.call(game, "q", ctx)).toBe(game);
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
