// @entries {"Text.queries.*": {"this": "read State"}}
// @run {"entry": "Text.queries.loud", "this": {"text": "hey"}, "args": []}
// A module's own const named as a host module (Text) shadows it, as a declaration shadows a
// global; what it imports from that module's specifier still comes from the host.
import { upper } from "app/text";

export type State = { text: string };

export const Text = {
	queries: {
		loud(): string {
			return upper(this.text);
		},
	},
};
