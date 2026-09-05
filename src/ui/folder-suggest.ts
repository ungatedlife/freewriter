import { AbstractInputSuggest, App, TFolder } from "obsidian";

/** Autocomplete for vault folders in a text input. */
export class FolderSuggest extends AbstractInputSuggest<TFolder> {
	constructor(
		app: App,
		private readonly textInputEl: HTMLInputElement,
	) {
		super(app, textInputEl);
	}

	getSuggestions(query: string): TFolder[] {
		const q = query.toLowerCase();
		const folders: TFolder[] = [];
		for (const f of this.app.vault.getAllLoadedFiles()) {
			if (f instanceof TFolder && f.path.toLowerCase().includes(q)) folders.push(f);
		}
		folders.sort((a, b) => a.path.localeCompare(b.path));
		return folders.slice(0, 60);
	}

	renderSuggestion(folder: TFolder, el: HTMLElement): void {
		el.setText(folder.path === "/" ? "/ (vault root)" : folder.path);
	}

	selectSuggestion(folder: TFolder, _evt: MouseEvent | KeyboardEvent): void {
		this.setValue(folder.path === "/" ? "" : folder.path);
		this.textInputEl.dispatchEvent(new Event("input"));
		this.close();
	}
}
