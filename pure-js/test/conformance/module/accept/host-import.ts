// @entries {"Shout.queries.*": {"this": "read State"}}
// @run {"entry": "Shout.queries.loud", "this": {"text": "hey"}, "args": []}
import { upper, repeat } from "app/text";

export type State = { text: string };

export const Shout = {
	queries: {
		loud(): string {
			return repeat(upper(this.text), 2);
		},
	},
};
