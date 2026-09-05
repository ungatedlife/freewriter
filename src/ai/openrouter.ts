import { requestUrl } from "obsidian";

export interface AiClient {
	complete(model: string, system: string, user: string): Promise<string>;
}

export interface OpenRouterModel {
	id: string;
	name: string;
}

const BASE_URL = "https://openrouter.ai/api/v1";
const REFERER = "https://github.com/ungatedlife/bridge";
const TITLE = "Freewriter for Obsidian";

interface ChatResponse {
	choices?: Array<{ message?: { content?: string | Array<{ type?: string; text?: string }> } }>;
	error?: { message?: string };
}

/** Minimal OpenRouter chat client. Only used when a route has AI formatting switched on. */
export class OpenRouterClient implements AiClient {
	constructor(private readonly getKey: () => string) {}

	async complete(model: string, system: string, user: string): Promise<string> {
		const key = this.getKey().trim();
		if (!key) throw new Error("no OpenRouter API key set");
		const response = await requestUrl({
			url: `${BASE_URL}/chat/completions`,
			method: "POST",
			headers: {
				Authorization: `Bearer ${key}`,
				"Content-Type": "application/json",
				"HTTP-Referer": REFERER,
				"X-Title": TITLE,
			},
			body: JSON.stringify({
				model,
				messages: [
					{ role: "system", content: system },
					{ role: "user", content: user },
				],
			}),
			throw: false,
		});
		let data: ChatResponse = {};
		try {
			data = response.json as ChatResponse;
		} catch {
			// non-JSON error body; handled below
		}
		if (response.status >= 400) {
			throw new Error(`OpenRouter returned ${response.status}${data.error?.message ? `: ${data.error.message}` : ""}`);
		}
		if (data.error?.message) throw new Error(data.error.message);
		const content = data.choices?.[0]?.message?.content;
		const text = typeof content === "string" ? content : Array.isArray(content) ? content.map((c) => c.text ?? "").join("") : "";
		return text.trim();
	}
}

export async function listOpenRouterModels(): Promise<OpenRouterModel[]> {
	const response = await requestUrl({ url: `${BASE_URL}/models`, method: "GET", throw: false });
	if (response.status >= 400) throw new Error(`OpenRouter returned ${response.status}`);
	const data = response.json as { data?: Array<{ id?: string; name?: string }> };
	const models: OpenRouterModel[] = [];
	for (const m of data.data ?? []) {
		if (typeof m.id === "string") models.push({ id: m.id, name: typeof m.name === "string" ? m.name : m.id });
	}
	models.sort((a, b) => a.id.localeCompare(b.id));
	return models;
}
