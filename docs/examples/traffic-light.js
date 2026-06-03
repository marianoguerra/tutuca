import { component, html } from "tutuca";

const TRAFFIC_LIGHTS = ["red", "orange", "green"];

const TrafficLight = component({
  name: "TrafficLight",
  fields: { lightIndex: 0 },
  methods: {
    light() {
      return TRAFFIC_LIGHTS[this.lightIndex];
    },
    nextLight() {
      return this.setLightIndex((this.lightIndex + 1) % TRAFFIC_LIGHTS.length);
    },
  },
  view: html`<section class="flex flex-col gap-2">
    <button class="btn btn-primary" @on.click="$nextLight">Next light</button>
    <p>Light is: <code @text="$light"></code></p>
    <p>
      You must
      <span @show="equals? $light 'red'">STOP</span>
      <span @show="equals? $light 'orange'">SLOW DOWN</span>
      <span @show="equals? $light 'green'">GO</span>
    </p>
  </section>`,
});

export function getComponents() {
  return [TrafficLight];
}

export function getRoot() {
  return TrafficLight.make({});
}

export function getExamples() {
  return {
    title: "Traffic Light",
    description: "Cycle a light through red, orange, and green",
    items: [
      {
        title: "Red",
        description: "Default starting light",
        value: TrafficLight.make(),
      },
      {
        title: "Green",
        description: "Start on the last light to see the wrap-around",
        value: TrafficLight.make({ lightIndex: 2 }),
      },
    ],
  };
}

export function getTests({ describe, test, expect }) {
  describe(TrafficLight, () => {
    describe("light()", () => {
      test("reads the color at the current index", () => {
        expect(TrafficLight.make().light()).toBe("red");
        expect(TrafficLight.make({ lightIndex: 1 }).light()).toBe("orange");
        expect(TrafficLight.make({ lightIndex: 2 }).light()).toBe("green");
      });
    });

    describe("nextLight()", () => {
      test("advances to the next light", () => {
        expect(TrafficLight.make().nextLight().lightIndex).toBe(1);
        expect(TrafficLight.make({ lightIndex: 1 }).nextLight().lightIndex).toBe(2);
      });
      test("wraps around past the last light", () => {
        expect(TrafficLight.make({ lightIndex: 2 }).nextLight().lightIndex).toBe(0);
      });
      test("does not mutate the original instance", () => {
        const tl = TrafficLight.make({ lightIndex: 1 });
        tl.nextLight();
        expect(tl.lightIndex).toBe(1);
      });
    });
  });
}
