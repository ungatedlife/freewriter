/**
 * A small in-memory stand-in for the parts of the Obsidian API the sync engine touches.
 * Only used by the tests (see vitest.config.ts).
 */
import * as yaml from "js-yaml";
import { frontMatterYaml, splitFrontMatter } from "../../src/frontmatter";

export function normalizePath(p: string): string {
	const clean = p.replace(/\\/g, "/").replace(/\/+/g, "/").replace(/^\/+|\/+$/g, "");
	return clean || "/";
}

export class TAbstractFile {
	path = "";
	name = "";
	parent: TFolder | null = null;
}

export class TFile extends TAbstractFile {
	basename = "";
	extension = "";
}

export class TFolder extends TAbstractFile {
	children: TAbstractFile[] = [];
	isRoot(): boolean {
		return this.path === "/";
	}
}

function parentPath(p: string): string {
	const i = p.lastIndexOf("/");
	return i === -1 ? "/" : p.slice(0, i);
}

export class Vault {
	files = new Map<string, string>();
	folders = new Set<string>(["/"]);
	private fileObjects = new Map<string, TFile>();
	private folderObjects = new Map<string, TFolder>();
	private store = new Map<string, string>();

	adapter = {
		exists: async (p: string): Promise<boolean> => this.store.has(normalizePath(p)),
		read: async (p: string): Promise<string> => {
			const v = this.store.get(normalizePath(p));
			if (v === undefined) throw new Error(`ENOENT ${p}`);
			return v;
		},
		write: async (p: string, data: string): Promise<void> => {
			this.store.set(normalizePath(p), data);
		},
	};

	private folderObject(path: string): TFolder {
		let f = this.folderObjects.get(path);
		if (!f) {
			f = new TFolder();
			f.path = path;
			f.name = path === "/" ? "" : path.slice(path.lastIndexOf("/") + 1);
			f.parent = path === "/" ? null : this.folderObject(parentPath(path));
			this.folderObjects.set(path, f);
		}
		return f;
	}

	private fileObject(path: string): TFile {
		let f = this.fileObjects.get(path);
		if (!f) {
			f = new TFile();
			f.path = path;
			f.name = path.slice(path.lastIndexOf("/") + 1);
			const dot = f.name.lastIndexOf(".");
			f.basename = dot === -1 ? f.name : f.name.slice(0, dot);
			f.extension = dot === -1 ? "" : f.name.slice(dot + 1);
			f.parent = this.folderObject(parentPath(path));
			this.fileObjects.set(path, f);
		}
		return f;
	}

	getAbstractFileByPath(p: string): TAbstractFile | null {
		const path = normalizePath(p);
		if (this.files.has(path)) return this.fileObject(path);
		if (this.folders.has(path)) return this.folderObject(path);
		return null;
	}

	getMarkdownFiles(): TFile[] {
		return Array.from(this.files.keys())
			.filter((p) => p.endsWith(".md"))
			.map((p) => this.fileObject(p));
	}

	getAllLoadedFiles(): TAbstractFile[] {
		return [...Array.from(this.folders).map((p) => this.folderObject(p)), ...this.getMarkdownFiles()];
	}

	async createFolder(p: string): Promise<TFolder> {
		const path = normalizePath(p);
		if (this.folders.has(path)) throw new Error(`Folder already exists: ${path}`);
		const parent = parentPath(path);
		if (!this.folders.has(parent)) throw new Error(`Parent folder does not exist: ${parent}`);
		this.folders.add(path);
		return this.folderObject(path);
	}

	async create(p: string, data: string): Promise<TFile> {
		const path = normalizePath(p);
		if (this.files.has(path)) throw new Error(`File already exists: ${path}`);
		const parent = parentPath(path);
		if (!this.folders.has(parent)) throw new Error(`Folder does not exist: ${parent}`);
		this.files.set(path, data);
		return this.fileObject(path);
	}

	async read(file: TFile): Promise<string> {
		const v = this.files.get(file.path);
		if (v === undefined) throw new Error(`File not found: ${file.path}`);
		return v;
	}

	async modify(file: TFile, data: string): Promise<void> {
		if (!this.files.has(file.path)) throw new Error(`File not found: ${file.path}`);
		this.files.set(file.path, data);
	}

	async rename(file: TFile, newPath: string): Promise<void> {
		const path = normalizePath(newPath);
		const data = this.files.get(file.path);
		if (data === undefined) throw new Error(`File not found: ${file.path}`);
		if (!this.folders.has(parentPath(path))) throw new Error(`Folder does not exist: ${parentPath(path)}`);
		this.files.delete(file.path);
		this.fileObjects.delete(file.path);
		this.files.set(path, data);
	}

	async delete(file: TFile): Promise<void> {
		this.files.delete(file.path);
		this.fileObjects.delete(file.path);
	}
}

const YAML_OPTS = { schema: yaml.JSON_SCHEMA };

export function parseYaml(text: string): unknown {
	return yaml.load(text, YAML_OPTS);
}

export function stringifyYaml(obj: unknown): string {
	return yaml.dump(obj, { ...YAML_OPTS, lineWidth: -1 });
}

function readFrontMatter(text: string): Record<string, unknown> | undefined {
	const { frontmatter } = splitFrontMatter(text);
	if (!frontmatter) return undefined;
	const parsed = parseYaml(frontMatterYaml(frontmatter));
	return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};
}

export class MetadataCache {
	constructor(private readonly vault: Vault) {}

	getFileCache(file: TFile): { frontmatter?: Record<string, unknown> } | null {
		const text = this.vault.files.get(file.path);
		if (text === undefined) return null;
		const frontmatter = readFrontMatter(text);
		return frontmatter ? { frontmatter } : {};
	}
}

export class FileManager {
	constructor(private readonly vault: Vault) {}

	async processFrontMatter(file: TFile, fn: (fm: Record<string, unknown>) => void): Promise<void> {
		const text = await this.vault.read(file);
		const { frontmatter, body } = splitFrontMatter(text);
		const data = (frontmatter ? readFrontMatter(text) : {}) ?? {};
		fn(data);
		const dumped = Object.keys(data).length ? stringifyYaml(data) : "";
		await this.vault.modify(file, `---\n${dumped}---\n${body}`);
	}
}

export class App {
	vault = new Vault();
	metadataCache = new MetadataCache(this.vault);
	fileManager = new FileManager(this.vault);
	workspace = { getActiveFile: (): TFile | null => null };
}

export class Notice {
	constructor(public message: string) {}
}

export async function requestUrl(): Promise<never> {
	throw new Error("network access is not available in tests");
}

export const moment = (d: Date | number) => ({ format: (f: string) => `${new Date(d).toISOString()}|${f}` });

export class Plugin {}
export class PluginSettingTab {}
export class Setting {}
export class Modal {}
export class AbstractInputSuggest<T> {
	constructor(_app: unknown, _el: unknown) {
		void _app;
		void _el;
	}
	setValue(_v: string): void {
		void _v;
	}
	close(): void {}
	getSuggestions(_q: string): T[] {
		void _q;
		return [];
	}
}
