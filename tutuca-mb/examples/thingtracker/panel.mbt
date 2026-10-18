// The chrome of a full screen panel, and the messages of closing one, from panel.js. Escape
// and ✕ ask first when the panel has something to lose.

///|
pub(all) enum CloseMsg {
  AskClose
  Pressed(String) // A key pressed in the panel.
  Keep
  Drop
} derive(Debug, ToJson, FromJson, @quickcheck.Arbitrary)

///|
/// Sent by a panel that closes; the app drops it.
pub let close_panel : Signal[Unit] = Signal::new("closePanel")

///|
/// The confirming flag after `msg`, notifying the app when the panel closes. `needs_confirm`
/// says whether closing would lose something.
fn[S, M] closing(
  confirming : Bool,
  needs_confirm : Bool,
  msg : CloseMsg,
  ctx : Ctx[S, M],
) -> Bool {
  match msg {
    AskClose =>
      if needs_confirm {
        true
      } else {
        ctx.notify(close_panel, ())
        confirming
      }
    Pressed(key) =>
      if key != "Escape" {
        confirming
      } else if confirming {
        false
      } else if needs_confirm {
        true
      } else {
        ctx.notify(close_panel, ())
        confirming
      }
    Keep => false
    Drop => {
      ctx.notify(close_panel, ())
      false
    }
  }
}

///|
/// What a panel's confirmation asks.
pub(all) struct Confirm {
  confirming : Bool
  title : String
  text : String
  keep : String
}

///|
/// A panel: a header with the title, the body and the footer, and the confirmation over them
/// when confirming. `close` wraps the closing messages in the panel's own.
fn[S, M] panel(
  title~ : (S) -> String,
  description~ : (S) -> String,
  extra~ : View[S, M] = frag([]),
  progress? : (S) -> String,
  body~ : View[S, M],
  foot~ : Array[View[S, M]],
  confirm~ : (S) -> Confirm,
  close~ : (CloseMsg) -> M,
) -> View[S, M] {
  div(
    [
      cls("absolute inset-0 z-40 flex flex-col bg-base-100"),
      attr("role", "dialog"),
      aria("modal", "true"),
      on_event(KeyDown, (_, e) => Some(close(Pressed(e.key())))),
    ],
    [
      header([cls("shrink-0 border-b border-base-300 pt-2 pb-2")], [
        div([cls("mx-auto flex max-w-2xl items-center gap-2 px-3")], [
          button(
            [
              cls("btn btn-ghost btn-square"),
              aria("label", "Close"),
              on_click(close(AskClose)),
            ],
            [txt("✕")],
          ),
          div([cls("min-w-0 flex-1")], [
            div([cls("truncate text-sm font-medium")], [show(title)]),
            when(
              s => description(s) != "",
              div([cls("truncate text-xs \{muted}")], [show(description)]),
            ),
          ]),
          extra,
        ]),
      ]),
      match progress {
        None => frag([])
        Some(style) =>
          div([cls("h-0.5 bg-base-200")], [
            div(
              [
                cls("h-full bg-primary transition-all"),
                bind_str("style", style),
              ],
              [],
            ),
          ])
      },
      div([cls("min-h-0 flex-1 overflow-y-auto overscroll-contain")], [
        div([cls("mx-auto max-w-2xl px-4 py-4")], [body]),
      ]),
      footer([cls("shrink-0 border-t border-base-300 pt-3 pb-3")], [
        div([cls("mx-auto flex max-w-2xl gap-2 px-4")], foot),
      ]),
      when(
        s => confirm(s).confirming,
        div(
          [
            cls(
              "absolute inset-0 z-50 flex items-center justify-center bg-black/50 p-4",
            ),
          ],
          [
            div(
              [
                cls(
                  "grid w-full max-w-xs gap-4 rounded-lg border border-base-300 bg-base-100 p-6 shadow-lg",
                ),
                attr("role", "alertdialog"),
              ],
              [
                div([cls("flex flex-col gap-2")], [
                  h2([cls("text-lg leading-none font-semibold")], [
                    show(s => confirm(s).title),
                  ]),
                  p([cls("text-sm \{muted}")], [show(s => confirm(s).text)]),
                ]),
                div(
                  [
                    cls(
                      "flex flex-col-reverse gap-2 sm:flex-row sm:justify-end",
                    ),
                  ],
                  [
                    button(
                      [cls("btn btn-outline btn-sm"), on_click(close(Keep))],
                      [show(s => confirm(s).keep)],
                    ),
                    button(
                      [cls("btn btn-error btn-sm"), on_click(close(Drop))],
                      [txt("Discard")],
                    ),
                  ],
                ),
              ],
            ),
          ],
        ),
      ),
    ],
  )
}
