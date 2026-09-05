import { AbstractInputSuggest, App } from "obsidian";

/**
 * Autocomplete over a list of strings. `queryOf` lets a comma-separated field
 * complete only its last item; `describe` adds a muted explanation per row.
 */
export class StringSuggest extends AbstractInputSuggest<string> {
	constructor(
		app: App,
		private readonly textInputEl: HTMLInputElement,
		private readonly getItems: () => string[],
		private readonly onPick: (value: string) => void,
		private readonly options: { queryOf?: (raw: string) => string; describe?: (value: string) => string | undefined; limit?: number } = {},
	) {
		super(app, textInputEl);
	}

	getSuggestions(raw: string): string[] {
		const query = (this.options.queryOf ? this.options.queryOf(raw) : raw).trim().toLowerCase();
		const items = this.getItems();
		const matches = query ? items.filter((item) => item.toLowerCase().includes(query)) : items;
		return matches.slice(0, this.options.limit ?? 30);
	}

	renderSuggestion(value: string, el: HTMLElement): void {
		el.createSpan({ text: value });
		const description = this.options.describe?.(value);
		if (description && description !== value) el.createSpan({ text: description, cls: "fw-suggest-desc" });
	}

	selectSuggestion(value: string, _evt: MouseEvent | KeyboardEvent): void {
		this.onPick(value);
		this.close();
		this.textInputEl.focus();
	}
}
