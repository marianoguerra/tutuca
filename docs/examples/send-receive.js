import { component, html } from "tutuca";

const Status = component({
  name: "Status",
  fields: { message: "", count: 0 },
  receive: {
    flash(message) {
      return this.setMessage(message).setCount(this.count + 1);
    },
    clear() {
      return this.resetMessage();
    },
  },
  view: html`<div
    class="alert alert-info"
    @show="truthy? .message"
  >
    <span @text=".message"></span>
    <small>(flashed <x text=".count"></x> times)</small>
  </div>`,
});

const SendReceive = component({
  name: "SendReceive",
  fields: { status: Status.make(), draft: "" },
  methods: {
    submit(ctx) {
      const text = this.draft.trim();
      if (text === "") return this;
      ctx.at.field("status").send("flash", [text]);
      ctx.send("clearDraft");
      return this;
    },
    clearStatus(ctx) {
      ctx.at.field("status").send("clear");
      return this;
    },
  },
  receive: {
    clearDraft() {
      return this.resetDraft();
    },
  },
  view: html`<section class="flex flex-col gap-2">
    <x render=".status"></x>
    <input
      class="input"
      :value=".draft"
      @on.input="$setDraft value"
      @on.keydown+send="$submit"
      placeholder="Type a message and press Enter"
    />
    <div class="flex gap-2">
      <button class="btn btn-primary" @on.click="$submit">
        Send
      </button>
      <button class="btn btn-ghost" @on.click="$clearStatus">
        Clear status
      </button>
    </div>
  </section>`,
});

export function getComponents() {
  return [SendReceive, Status];
}

export function getRoot() {
  return SendReceive.make({});
}

export function getExamples() {
  return {
    title: "Send / Receive",
    description: "Targeted messages between components",
    items: [
      {
        title: "Default",
        description: "Type a message and press Enter to flash the status",
        value: SendReceive.make(),
      },
      {
        title: "With prior flash",
        description: "Status pre-populated to show what flash() does",
        value: SendReceive.make({
          status: Status.make({ message: "Hello!", count: 2 }),
        }),
      },
    ],
  };
}
