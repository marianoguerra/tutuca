---
name: blockkit-lab
description: Building Slack Block Kit message payloads, previewing them and keeping them within Slack's limits.
---

# Block Kit lab

The part `blockkit` holds a Slack message payload, `{blocks: [...]}` (other keys such as the
fallback `text` are kept). Blocks are plain Slack JSON.

Supported blocks: `section`, `header`, `divider`, `context`, `actions`, `image`, `input`. The
preview renders mrkdwn's `*bold*`, `_italic_`, `~strike~`, `` `code` ``, `<url|label>` links,
`<@U123>` mentions and newlines.

Workflow:
1. `preview_text` and `problems` to see where the message stands.
2. `add_block`, `set_block`, `move_block`, `remove_block` to change it, one block at a time.
3. `payload` gives the JSON to paste into Slack's Block Kit Builder.
