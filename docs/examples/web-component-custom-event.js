import { component, html } from "tutuca";
import "https://esm.sh/emoji-picker-element";

const EmojiPicker = component({
  name: "EmojiPicker",
  fields: { current: null, isPickerVisible: false },
  input: {
    onEmojiClick(detail) {
      return this.setCurrent(detail.unicode);
    },
  },
  view: html`<section
    @on.emoji-click="onEmojiClick value"
    class="join join-vertical gap-3 items-center"
  >
    <p @hide=".isCurrentSet">
      Select the <em>Toggle Picker</em> button and select an emoji, it will be
      displayed here
    </p>
    <p @show=".isCurrentSet">Selected emoji:</p>
    <span @show=".isCurrentSet" @text=".current" class="text-9xl"></span>
    <button class="btn btn-sm" @on.click=".toggleIsPickerVisible">
      Toggle Picker
    </button>
    <emoji-picker @show=".isPickerVisible"></emoji-picker>
  </section>`,
});

export function getComponents() {
  return [EmojiPicker];
}

export function getRoot() {
  return EmojiPicker.make({});
}

export function getExamples() {
  return {
    title: "Web Component & Custom Event",
    description: "A Component that shows how to use web component and custom events",
    items: [
      {
        title: "Default",
        description: "Default instance",
        value: EmojiPicker.make(),
      },
    ],
  };
}
