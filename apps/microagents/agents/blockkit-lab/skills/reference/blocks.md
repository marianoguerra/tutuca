# Blocks and limits

| block | shape | limits |
|---|---|---|
| header | `{type: "header", text: {type: "plain_text", text}}` | text ≤ 150, plain_text only |
| section | `{type: "section", text?, fields?, accessory?}` | text ≤ 3000; ≤ 10 fields, each ≤ 2000; text or fields required |
| divider | `{type: "divider"}` | |
| context | `{type: "context", elements: [text or image]}` | 1-10 elements |
| actions | `{type: "actions", elements: [button, …]}` | 1-25 elements; action_id unique in the block |
| image | `{type: "image", image_url, alt_text, title?}` | image_url ≤ 3000, alt_text ≤ 2000 |
| input | `{type: "input", label, element: {type: "plain_text_input", action_id, multiline?}}` | label ≤ 2000, plain_text |

A message has at most 50 blocks. `block_id` (optional) is ≤ 255 characters and unique.

A text object is `{type: "mrkdwn" | "plain_text", text}`. A button is
`{type: "button", text: {type: "plain_text", text}, action_id, style?: "primary" | "danger",
url?, value?}`, text ≤ 75. An image element is `{type: "image", image_url, alt_text}`.

mrkdwn: `*bold*`, `_italic_`, `~strike~`, `` `code` ``, `<https://x.com|label>`, `<@U123>`
(user), `<#C123>` (channel), `<!here>`; escape `&`, `<`, `>` as `&amp;`, `&lt;`, `&gt;`.
