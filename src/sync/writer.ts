import { App, TFile, TFolder, normalizePath } from "obsidian";

export type FrontMatter = Record<string, unknown>;

/** Every vault write goes through the Vault API so Obsidian's cache and sync see it immediately. */
export class VaultWriter {
	constructor(private app: App) {}

	fileAt(vaultPath: string): TFile | null {
		const f = this.app.vault.getAbstractFileByPath(normalizePath(vaultPath));
		return f instanceof TFile ? f : null;
	}

	exists(vaultPath: string): boolean {
		return this.app.vault.getAbstractFileByPath(normalizePath(vaultPath)) !== null;
	}

	identityOf(file: TFile, idKey: string): string | null {
		const value: unknown = this.app.metadataCache.getFileCache(file)?.frontmatter?.[idKey];
		return typeof value === "string" ? value : null;
	}

	/** Map identity value → note, built once per run from the metadata cache. */
	buildIdentityIndex(idKey: string): Map<string, TFile> {
		const index = new Map<string, TFile>();
		for (const file of this.app.vault.getMarkdownFiles()) {
			const id = this.identityOf(file, idKey);
			if (id && !index.has(id)) index.set(id, file);
		}
		return index;
	}

	async ensureFolder(folder: string): Promise<void> {
		const clean = normalizePath(folder);
		if (!clean || clean === "/" || clean === ".") return;
		let current = "";
		for (const part of clean.split("/")) {
			current = current ? `${current}/${part}` : part;
			const existing = this.app.vault.getAbstractFileByPath(current);
			if (existing instanceof TFolder) continue;
			if (existing) throw new Error(`"${current}" exists but is not a folder`);
			try {
				await this.app.vault.createFolder(current);
			} catch (e) {
				if (!this.app.vault.getAbstractFileByPath(current)) throw e;
			}
		}
	}

	async createNote(notePath: string, text: string): Promise<TFile> {
		const clean = normalizePath(notePath);
		const slash = clean.lastIndexOf("/");
		if (slash !== -1) await this.ensureFolder(clean.slice(0, slash));
		return this.app.vault.create(clean, text);
	}

	readNote(file: TFile): Promise<string> {
		return this.app.vault.read(file);
	}

	writeNote(file: TFile, text: string): Promise<void> {
		return this.app.vault.modify(file, text);
	}

	setProperties(file: TFile, mutate: (fm: FrontMatter) => void): Promise<void> {
		return this.app.fileManager.processFrontMatter(file, (fm: FrontMatter) => mutate(fm));
	}
}
