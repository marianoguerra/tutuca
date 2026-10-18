// 4. Talking to the outside world: a component asks, a handler answers. ctx.ask names a typed
// key; the handler is registered next to the components, in a scope, and its answer comes
// back as a message: Ok, Err or NotFound when nobody handles it. Handlers are swappable:
// these stories answer from a table, or hold the answer so you can see the loading state.

///|
using @tutuca {
  div,
  form,
  input,
  button,
  p,
  span,
  txt,
  show,
  cls,
  class_,
  aria,
  value,
  when,
  on_input,
  on_submit,
}

///|
/// Asks for the forecast of a city: a String in, a String back.
pub let lookup : @tutuca.Ask[String, String] = @tutuca.Ask::new("lookup")

///|
pub(all) enum Status {
  Idle
  Loading
  Done
  Failed
} derive(Eq, Debug, ToJson, FromJson, @quickcheck.Arbitrary)

///|
pub(all) struct Weather {
  city : String
  status : Status
  report : String
} derive(Eq, Debug, ToJson, FromJson, @quickcheck.Arbitrary)

///|
pub(all) enum WeatherMsg {
  SetCity(String)
  Lookup
  Got(@tutuca.AskResult[String])
} derive(Debug, ToJson, FromJson, @quickcheck.Arbitrary)

///|
pub let weather : @tutuca.Component[Weather, WeatherMsg] = @tutuca.component(
  "Weather",
  view=() => {
    div([cls("flex max-w-sm flex-col gap-3")], [
      form([cls("join"), on_submit(Lookup)], [
        input([
          cls("input join-item"),
          aria("label", "City"),
          value(s => s.city),
          on_input(v => SetCity(v)),
        ]),
        button([cls("btn btn-primary join-item")], [txt("Look up")]),
      ]),
      when(s => s.status == Loading, span([cls("loading loading-dots")], [])),
      when(
        s => s.status == Done || s.status == Failed,
        p(
          [
            class_(s => {
              if s.status == Failed {
                "alert alert-error"
              } else {
                "alert alert-info"
              }
            }),
          ],
          [show(s => s.report)],
        ),
      ),
    ])
  },
  update=(s, msg, ctx) => {
    match msg {
      SetCity(city) => { ..s, city, }
      Lookup => {
        // The answer comes back as Got(...), whenever the handler replies.
        ctx.ask(lookup, s.city, r => Some(Got(r)))
        { ..s, status: Loading, }
      }
      Got(Ok(report)) => { ..s, status: Done, report, }
      Got(Err(error)) => { ..s, status: Failed, report: error, }
      Got(NotFound) =>
        { ..s, status: Failed, report: "nobody answers lookup here", }
    }
  },
)

///|
let forecasts : Map[String, String] = {
  "lisbon": "☀️ 24°C",
  "oslo": "🌧️ 9°C",
  "tokyo": "⛅ 18°C",
}

///|
/// Answers from the table, right away.
fn from_table(scope : @tutuca.Scope) -> Unit {
  scope.handle(lookup, (city, reply) => {
    match forecasts.get(city.trim().to_owned().to_lower()) {
      Some(f) => reply(Ok("\{city}: \{f}"))
      None => reply(Err("No forecast for \{city}. Try Oslo or Tokyo."))
    }
  })
}

///|
/// Never answers: the steps send the reply themselves.
fn holding(scope : @tutuca.Scope) -> Unit {
  scope.handle(lookup, (_, _) => ())
}

///|
fn start(city : String) -> Weather {
  { city, status: Idle, report: "", }
}

///|
pub fn[N : @vdom.DomNode] books() -> Array[@storybook.Book[N]] {
  let submit = @storybook.event("submit", @storybook.find("form"))
  [
    @storybook.book("Weather", [
      @storybook.story(
        "Lisbon",
        weather,
        () => start("Lisbon"),
        asks=from_table,
        sequences=[
          (
            "ask",
            [
              submit,
              @storybook.check("shows the forecast", s => {
                s.report.contains("24°C")
              }),
            ],
          ),
        ],
        targets=[@testing.root_messages(keep=m => !(m is Got(_)))],
      ),
      @storybook.story(
        "Atlantis",
        weather,
        () => start("Atlantis"),
        asks=from_table,
        sequences=[
          (
            "no forecast",
            [submit, @storybook.check("fails", s => s.status == Failed)],
          ),
        ],
      ),
      @storybook.story(
        "Waiting for the answer",
        weather,
        () => start("Lisbon"),
        asks=holding,
        sequences=[
          (
            "ask, then answer",
            [
              submit,
              @storybook.check("loading", s => s.status == Loading),
              @storybook.send(Got(Ok("Lisbon: ☀️ 24°C"))),
              @storybook.check("shows the forecast", s => {
                s.report.contains("24°C")
              }),
            ],
          ),
          (
            "ask, then fail",
            [
              submit,
              @storybook.send(Got(Err("offline"))),
              @storybook.check("shows the error", s => s.status == Failed),
            ],
          ),
        ],
      ),
    ]),
  ]
}
