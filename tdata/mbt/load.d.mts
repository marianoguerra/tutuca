// Types for load.mjs.

export interface Engine {
	tq_parse(query: string): string;
	tq_run(query: string, messageJson: string): string;
	tq_match(query: string, messageJson: string): string;
	tq_match_all(query: string, messageJson: string): string;
	tq_canon(messageJson: string): string;
}

export function instantiateWasm(bytes: BufferSource): Promise<Engine>;
export function loadWasm(): Promise<Engine>;
export function loadJs(): Promise<Engine>;
