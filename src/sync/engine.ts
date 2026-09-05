import { App, TFile, normalizePath } from "obsidian";
import * as path from "path";
import { getAdapter, type ParsedDraft, type SourceAdapter } from "../adapters";
import type { AiClient } from "../ai/openrouter";
import { joinVaultPath, sanitizeFilename, uniqueName } from "../filename";
import { splitFrontMatter } from "../frontmatter";
import { sha256 } from "../hash";
import { DEFAULT_AI_TITLE_INSTRUCTIONS, DEFAULT_BODY_TEMPLATE, type FreewriterSettings, type Route } from "../settings";
import type { SourceRecord, SyncState } from "../state";
import { collapseBlankLines, countWords, ensureContentPlaceholder, renderTemplate, type DateFormatter, type TemplateContext } from "../template";
import { buildFrontMatterYaml } from "../yaml";
import { decideUpdate } from "./linker";
import { scanRoute } from "./scanner";
import { listSourceFolder, readSourceFile, sourceExists, type SourceEntry } from "./source";
import { VaultWriter } from "./writer";

export type PlanKind = "create" | "update" | "conflict" | "skip" | "adopt" | "move" | "missing" | "error";

export interface PlanItem {
	kind: PlanKind;
	route: string;
	source: string;
	note?: string;
	detail?: string;
}

export interface RunReport {
	startedAt: number;
	finishedAt: number;
	dryRun: boolean;
	items: PlanItem[];
	unchanged: number;
	counts: Record<PlanKind, number>;
}

export interface LogEvent {
	time: number;
	level: "info" | "warn" | "error";
	route: string;
	message: string;
}

export interface RunOptions {
	routeIds?: string[];
	dryRun?: boolean;
}

interface AiResult {
	text: string;
	title: string | null;
}

const NO_AI: AiResult = { text: "", title: null };
const MAX_EVENTS = 300;
const AI_PLACEHOLDER = /\{\{\s*ai\s*\}\}/;
const FORMAT_SYSTEM =
	"You help a writer bring drafts from a Freewrite typewriter into their notes. Follow the instructions below exactly. Reply in Markdown only, with no preamble, no commentary and no code fences.\n\nInstructions:\n";
const TITLE_SYSTEM =
	"You name drafts for a writer's notes. Reply with a single title on one line: no quotes, no trailing punctuation, no commentary.\n\nInstructions:\n";
const TITLE_INPUT_LIMIT = 8000;

function emptyCounts(): Record<PlanKind, number> {
	return { create: 0, update: 0, conflict: 0, skip: 0, adopt: 0, move: 0, missing: 0, error: 0 };
}

function newReport(dryRun: boolean): RunReport {
	return { startedAt: Date.now(), finishedAt: 0, dryRun, items: [], unchanged: 0, counts: emptyCounts() };
}

function errorMessage(e: unknown): string {
	return e instanceof Error ? e.message : String(e);
}

/** First line of a model reply, without quotes, heading marks or a trailing period. */
export function cleanTitle(raw: string): string {
	const line = raw
		.split("\n")
		.map((l) => l.trim())
		.find((l) => l.length > 0);
	if (!line) return "";
	let title = line.replace(/^#{1,6}\s+/, "").replace(/^(?:title:\s*)/i, "");
	title = title.replace(/^["'“‘]+|["'”’]+$/g, "").replace(/\.$/, "").replace(/\s+/g, " ").trim();
	if (title.length > 80) {
		const cut = title.lastIndexOf(" ", 80);
		title = title.slice(0, cut >= 40 ? cut : 80).trim();
	}
	return title;
}

export class SyncEngine {
	readonly events: LogEvent[] = [];
	lastReport: RunReport | null = null;
	private running = false;
	private queued: RunOptions | null = null;
	private readonly writer: VaultWriter;

	constructor(
		private readonly app: App,
		private readonly getSettings: () => FreewriterSettings,
		private readonly getState: () => SyncState,
		private readonly saveState: () => Promise<void>,
		private readonly formatDate: DateFormatter,
		private readonly onChange: () => void,
		private readonly getAi: () => AiClient | null = () => null,
	) {
		this.writer = new VaultWriter(app);
	}

	get isRunning(): boolean {
		return this.running;
	}

	log(level: LogEvent["level"], route: string, message: string): void {
		this.events.push({ time: Date.now(), level, route, message });
		if (this.events.length > MAX_EVENTS) this.events.splice(0, this.events.length - MAX_EVENTS);
		if (level === "error") console.error(`Freewriter${route ? ` [${route}]` : ""}: ${message}`);
	}

	async run(opts: RunOptions = {}): Promise<RunReport> {
		if (this.running) {
			this.queued = { ...(this.queued ?? {}), ...opts, routeIds: undefined };
			return this.lastReport ?? newReport(opts.dryRun ?? false);
		}
		this.running = true;
		this.onChange();
		const report = newReport(opts.dryRun ?? false);
		try {
			const settings = this.getSettings();
			const state = this.getState();
			if (!report.dryRun) this.pruneState(state, settings);
			const index = this.writer.buildIdentityIndex(settings.identityProperty);
			for (const route of settings.routes) {
				if (!route.enabled) continue;
				if (opts.routeIds && !opts.routeIds.includes(route.id)) continue;
				await this.runRoute(route, settings, state, index, report);
			}
			if (!report.dryRun) await this.saveState();
		} catch (e) {
			this.log("error", "", `Sync failed: ${errorMessage(e)}`);
			report.items.push({ kind: "error", route: "", source: "", detail: errorMessage(e) });
		} finally {
			report.finishedAt = Date.now();
			for (const item of report.items) report.counts[item.kind]++;
			if (!report.dryRun) {
				this.lastReport = report;
				const summary = this.summarize(report);
				if (summary) this.log("info", "", summary);
			}
			this.running = false;
			this.onChange();
			if (this.queued) {
				const next = this.queued;
				this.queued = null;
				void this.run(next);
			}
		}
		return report;
	}

	summarize(report: RunReport): string {
		const parts: string[] = [];
		const c = report.counts;
		if (c.create) parts.push(`${c.create} created`);
		if (c.update) parts.push(`${c.update} updated`);
		if (c.conflict) parts.push(`${c.conflict} conflict${c.conflict === 1 ? "" : "s"}`);
		if (c.move) parts.push(`${c.move} moved`);
		if (c.adopt) parts.push(`${c.adopt} linked`);
		if (c.skip) parts.push(`${c.skip} skipped`);
		if (c.missing) parts.push(`${c.missing} missing`);
		if (c.error) parts.push(`${c.error} error${c.error === 1 ? "" : "s"}`);
		return parts.join(", ");
	}

	/** Record for the note at this vault path, if Freewriter manages it. */
	recordForNote(notePath: string): SourceRecord | null {
		for (const rec of Object.values(this.getState().records)) {
			if (rec.notePath === notePath) return rec;
		}
		return null;
	}

	async detachNote(file: TFile, rec: SourceRecord): Promise<void> {
		const settings = this.getSettings();
		await this.writer.setProperties(file, (fm) => {
			delete fm[settings.identityProperty];
			fm[settings.statusProperty] = "detached";
		});
		rec.status = "detached";
		rec.notePath = null;
		rec.bodyHash = null;
		await this.saveState();
		this.log("info", "", `Detached ${file.path} from ${rec.sourceKey}`);
		this.onChange();
	}

	/**
	 * Link source files that have no record yet to existing notes with the same base name
	 * (for people who already have copies in their vault). The note is assumed to be in sync now.
	 */
	async linkExistingByName(): Promise<number> {
		const settings = this.getSettings();
		const state = this.getState();
		let linked = 0;
		const byBase = new Map<string, TFile[]>();
		for (const file of this.app.vault.getMarkdownFiles()) {
			if (this.writer.identityOf(file, settings.identityProperty)) continue;
			const list = byBase.get(file.basename) ?? [];
			list.push(file);
			byBase.set(file.basename, list);
		}
		for (const route of settings.routes) {
			if (!route.enabled || !route.sourcePath) continue;
			const adapter = getAdapter(route.adapter);
			let entries: SourceEntry[];
			try {
				entries = await listSourceFolder(route.sourcePath, (n) => adapter.matches(n));
			} catch (e) {
				this.log("error", route.name, `Cannot read source folder: ${errorMessage(e)}`);
				continue;
			}
			const folderLabel = path.basename(route.sourcePath) || route.name;
			const destination = normalizePath(route.destination || "/");
			for (const entry of entries) {
				if (state.records[entry.path]) continue;
				const stem = entry.name.replace(/\.[^.]+$/, "");
				const candidates = byBase.get(stem);
				if (!candidates?.length) continue;
				const inDestination = candidates.find((f) => f.parent?.path === destination);
				const note = inDestination ?? candidates[0];
				const raw = await readSourceFile(entry.path);
				const parsed = adapter.parse(entry.name, raw, entry, { stripTitleLine: route.stripTitleLine });
				const sourceKey = `${folderLabel}/${entry.name}`;
				await this.writer.setProperties(note, (fm) => {
					fm[settings.identityProperty] = sourceKey;
				});
				const body = splitFrontMatter(await this.writer.readNote(note)).body;
				state.records[entry.path] = this.makeRecord(route, entry, sourceKey, sha256(parsed.fullText), note.path, sha256(body));
				byBase.set(stem, candidates.filter((f) => f !== note));
				linked++;
				this.log("info", route.name, `Linked ${note.path} to ${sourceKey}`);
			}
		}
		await this.saveState();
		this.onChange();
		return linked;
	}

	private pruneState(state: SyncState, settings: FreewriterSettings): void {
		const routeIds = new Set(settings.routes.map((r) => r.id));
		for (const [key, rec] of Object.entries(state.records)) {
			if (!routeIds.has(rec.routeId)) delete state.records[key];
		}
	}

	private push(report: RunReport, kind: PlanKind, route: Route, source: string, note?: string, detail?: string): void {
		report.items.push({ kind, route: route.name, source, note, detail });
		if (!report.dryRun) {
			const level = kind === "conflict" || kind === "missing" ? "warn" : kind === "error" ? "error" : "info";
			this.log(level, route.name, `${kind}: ${source}${note ? ` → ${note}` : ""}${detail ? ` (${detail})` : ""}`);
		}
	}

	private async runRoute(
		route: Route,
		settings: FreewriterSettings,
		state: SyncState,
		index: Map<string, TFile>,
		report: RunReport,
	): Promise<void> {
		if (!route.sourcePath) {
			this.log("warn", route.name, "No source folder set");
			return;
		}
		const adapter = getAdapter(route.adapter);
		let entries: SourceEntry[];
		try {
			entries = await listSourceFolder(route.sourcePath, (n) => adapter.matches(n));
		} catch (e) {
			report.items.push({ kind: "error", route: route.name, source: route.sourcePath, detail: errorMessage(e) });
			this.log("error", route.name, `Cannot read source folder: ${errorMessage(e)}`);
			return;
		}
		const scan = scanRoute(route.id, entries, state);
		report.unchanged += scan.unchanged.length;
		const folderLabel = path.basename(route.sourcePath) || route.name;
		for (const entry of scan.candidates) {
			try {
				await this.processEntry(route, settings, state, index, report, entry, folderLabel, adapter);
			} catch (e) {
				report.items.push({ kind: "error", route: route.name, source: entry.name, detail: errorMessage(e) });
				this.log("error", route.name, `${entry.name}: ${errorMessage(e)}`);
			}
		}
		for (const rec of scan.missing) {
			await this.handleMissing(route, settings, rec, report);
		}
	}

	private async processEntry(
		route: Route,
		settings: FreewriterSettings,
		state: SyncState,
		index: Map<string, TFile>,
		report: RunReport,
		entry: SourceEntry,
		folderLabel: string,
		adapter: SourceAdapter,
	): Promise<void> {
		const raw = await readSourceFile(entry.path);
		const parsed = adapter.parse(entry.name, raw, entry, { stripTitleLine: route.stripTitleLine });
		const contentHash = sha256(parsed.fullText);
		const sourceKey = `${folderLabel}/${entry.name}`;
		const idKey = settings.identityProperty;
		const record: SourceRecord | undefined = state.records[entry.path];

		// Resolve the linked note: the remembered path if the link is intact, else the identity index.
		let note: TFile | null = null;
		if (record?.notePath) {
			const remembered = this.writer.fileAt(record.notePath);
			if (remembered && this.writer.identityOf(remembered, idKey) === sourceKey) note = remembered;
		}
		if (!note) note = index.get(sourceKey) ?? null;

		// A note we have no record of (state lost, or made on another machine): assume it is in sync now.
		if (note && !record) {
			if (!report.dryRun) {
				const body = splitFrontMatter(await this.writer.readNote(note)).body;
				state.records[entry.path] = this.makeRecord(route, entry, sourceKey, contentHash, note.path, sha256(body));
			}
			this.push(report, "adopt", route, entry.name, note.path);
			return;
		}

		// Touched on disk but the text is the same: just refresh the record.
		if (record && record.contentHash === contentHash) {
			if (!report.dryRun) {
				record.routeId = route.id;
				record.size = entry.size;
				record.mtimeMs = entry.mtimeMs;
				if (note) {
					record.notePath = note.path;
					if (record.status === "missing") await this.clearMissing(record, note, settings);
				}
			}
			report.unchanged++;
			return;
		}

		// A draft moved between folders on the device shows up as a new file with known content.
		if (!note && !record) {
			const moved = this.findMovedRecord(state, contentHash, entry.path);
			const movedNote = moved?.notePath ? this.writer.fileAt(moved.notePath) : null;
			if (moved && movedNote) {
				if (!report.dryRun) {
					await this.writer.setProperties(movedNote, (fm) => {
						fm[idKey] = sourceKey;
						if (fm[settings.statusProperty] === "source-missing") delete fm[settings.statusProperty];
					});
					delete state.records[moved.sourcePath];
					state.records[entry.path] = {
						...moved,
						routeId: route.id,
						sourceKey,
						sourcePath: entry.path,
						size: entry.size,
						mtimeMs: entry.mtimeMs,
						contentHash,
						notePath: movedNote.path,
						status: "synced",
						lastSyncedAt: Date.now(),
					};
					index.set(sourceKey, movedNote);
				}
				this.push(report, "move", route, entry.name, movedNote.path, `was ${moved.sourceKey}`);
				return;
			}
		}

		if (!note) {
			const ai = report.dryRun ? NO_AI : await this.runAi(route, settings, parsed, true);
			const ctx = this.buildContext(route, parsed, entry, folderLabel, sourceKey, ai);
			const rendered = renderTemplate(route.filenameTemplate || "{{title}}", ctx, this.formatDate);
			const baseName = sanitizeFilename(rendered, sanitizeFilename(parsed.title));
			const folder = normalizePath(route.destination || "/");
			const name = uniqueName(baseName, (c) => this.writer.exists(joinVaultPath(folder, `${c}.md`)));
			const notePath = joinVaultPath(folder, `${name}.md`);
			if (!report.dryRun) {
				const file = await this.writer.createNote(notePath, this.assembleNote(route, ctx, ai.text));
				await this.writer.setProperties(file, (fm) => {
					fm[idKey] = sourceKey;
				});
				const body = splitFrontMatter(await this.writer.readNote(file)).body;
				state.records[entry.path] = this.makeRecord(route, entry, sourceKey, contentHash, file.path, sha256(body));
				index.set(sourceKey, file);
			}
			this.push(report, "create", route, entry.name, notePath, record?.status === "detached" ? "previous note was detached" : undefined);
			return;
		}

		const currentText = await this.writer.readNote(note);
		const split = splitFrontMatter(currentText);
		const currentBodyHash = sha256(split.body);
		const decision = decideUpdate(route.updatePolicy, true, currentBodyHash, record?.bodyHash ?? null);

		if (decision === "skip-once") {
			if (!report.dryRun && record) {
				record.contentHash = contentHash;
				record.size = entry.size;
				record.mtimeMs = entry.mtimeMs;
				record.notePath = note.path;
			}
			this.push(report, "skip", route, entry.name, note.path, "route imports once");
			return;
		}

		if (decision === "overwrite") {
			if (!report.dryRun) {
				const ai = await this.runAi(route, settings, parsed, false);
				const ctx = this.buildContext(route, parsed, entry, folderLabel, sourceKey, ai);
				await this.writer.writeNote(note, (split.frontmatter ?? "") + this.renderBody(route, ctx, ai.text));
				if (!split.frontmatter) {
					await this.writer.setProperties(note, (fm) => {
						fm[idKey] = sourceKey;
					});
				}
				const body = splitFrontMatter(await this.writer.readNote(note)).body;
				const rec = record ?? this.makeRecord(route, entry, sourceKey, contentHash, note.path, null);
				const wasMissing = rec.status === "missing";
				Object.assign(rec, {
					routeId: route.id,
					sourceKey,
					size: entry.size,
					mtimeMs: entry.mtimeMs,
					contentHash,
					notePath: note.path,
					bodyHash: sha256(body),
					status: "synced",
					lastSyncedAt: Date.now(),
				});
				if (wasMissing) await this.clearMissing(rec, note, settings);
				state.records[entry.path] = rec;
			}
			this.push(report, "update", route, entry.name, note.path);
			return;
		}

		// Conflict: the note was edited in Obsidian. Keep it, detach it, and land the new draft beside it.
		const ai = report.dryRun ? NO_AI : await this.runAi(route, settings, parsed, false);
		const ctx = this.buildContext(route, parsed, entry, folderLabel, sourceKey, ai);
		const suffix = renderTemplate(settings.conflictSuffixTemplate, ctx, this.formatDate);
		const parent = note.parent?.path ?? "/";
		const copyBase = uniqueName(sanitizeFilename(`${note.basename} ${suffix}`), (c) => this.writer.exists(joinVaultPath(parent, `${c}.md`)));
		const copyPath = joinVaultPath(parent, `${copyBase}.md`);
		if (!report.dryRun) {
			const copy = await this.writer.createNote(copyPath, this.assembleNote(route, ctx, ai.text));
			await this.writer.setProperties(copy, (fm) => {
				fm[idKey] = sourceKey;
			});
			await this.writer.setProperties(note, (fm) => {
				delete fm[idKey];
				fm[settings.statusProperty] = "detached";
			});
			const body = splitFrontMatter(await this.writer.readNote(copy)).body;
			state.records[entry.path] = { ...this.makeRecord(route, entry, sourceKey, contentHash, copy.path, sha256(body)), status: "conflict" };
			index.set(sourceKey, copy);
		}
		this.push(report, "conflict", route, entry.name, copyPath, `your edited version stays in ${note.path}`);
	}

	/** Run the route's AI instructions (and optionally a title request). Failures degrade to no AI text. */
	private async runAi(route: Route, settings: FreewriterSettings, parsed: ParsedDraft, wantTitle: boolean): Promise<AiResult> {
		if (!route.ai.enabled) return NO_AI;
		const result: AiResult = { text: "", title: null };
		const client = this.getAi();
		const model = settings.openRouterModel.trim();
		if (!client) {
			this.log("warn", route.name, "AI is switched on for this route but no OpenRouter API key is set; importing without it.");
			return result;
		}
		if (!model) {
			this.log("warn", route.name, "AI is switched on for this route but no model is set; importing without it.");
			return result;
		}
		const draft = parsed.content.trim();
		if (!draft) return result;
		if (route.ai.instructions.trim()) {
			try {
				result.text = await client.complete(model, FORMAT_SYSTEM + route.ai.instructions.trim(), draft);
			} catch (e) {
				this.log("warn", route.name, `AI formatting failed, imported without it: ${errorMessage(e)}`);
			}
		}
		if (wantTitle && route.ai.title) {
			try {
				const instructions = route.ai.titleInstructions.trim() || DEFAULT_AI_TITLE_INSTRUCTIONS;
				const title = cleanTitle(await client.complete(model, TITLE_SYSTEM + instructions, draft.slice(0, TITLE_INPUT_LIMIT)));
				if (title) result.title = title;
			} catch (e) {
				this.log("warn", route.name, `AI title failed, used the draft title: ${errorMessage(e)}`);
			}
		}
		return result;
	}

	/** Front matter from the route's properties followed by the rendered body. */
	private assembleNote(route: Route, ctx: TemplateContext, aiText: string): string {
		const frontMatter = buildFrontMatterYaml(
			route.properties.map((p) => ({ key: p.key, type: p.type, value: renderTemplate(p.value, ctx, this.formatDate) })),
		);
		return frontMatter + this.renderBody(route, ctx, aiText);
	}

	private renderBody(route: Route, ctx: TemplateContext, aiText: string): string {
		let template = ensureContentPlaceholder(route.bodyTemplate || DEFAULT_BODY_TEMPLATE);
		if (aiText && route.ai.placement !== "replace" && !AI_PLACEHOLDER.test(template)) {
			template = route.ai.placement === "above" ? `{{ai}}\n\n${template}` : `${template.replace(/\s+$/, "")}\n\n{{ai}}`;
		}
		const body = collapseBlankLines(renderTemplate(template, ctx, this.formatDate)).replace(/\s+$/, "");
		return body ? `${body}\n` : "";
	}

	private async handleMissing(route: Route, settings: FreewriterSettings, rec: SourceRecord, report: RunReport): Promise<void> {
		if (!report.dryRun) {
			rec.status = "missing";
			if (settings.markMissingSources && rec.notePath) {
				const file = this.writer.fileAt(rec.notePath);
				if (file) {
					await this.writer.setProperties(file, (fm) => {
						fm[settings.statusProperty] = "source-missing";
					});
				}
			}
		}
		this.push(report, "missing", route, path.basename(rec.sourcePath), rec.notePath ?? undefined, "draft no longer in the source folder");
	}

	private async clearMissing(rec: SourceRecord, note: TFile, settings: FreewriterSettings): Promise<void> {
		rec.status = "synced";
		await this.writer.setProperties(note, (fm) => {
			if (fm[settings.statusProperty] === "source-missing") delete fm[settings.statusProperty];
		});
	}

	private findMovedRecord(state: SyncState, contentHash: string, exceptPath: string): SourceRecord | null {
		for (const rec of Object.values(state.records)) {
			if (rec.sourcePath === exceptPath || rec.contentHash !== contentHash || !rec.notePath) continue;
			if (rec.status === "missing" || !sourceExists(rec.sourcePath)) return rec;
		}
		return null;
	}

	private buildContext(route: Route, parsed: ParsedDraft, entry: SourceEntry, folderLabel: string, sourceKey: string, ai: AiResult): TemplateContext {
		const replace = route.ai.enabled && route.ai.placement === "replace" && ai.text;
		return {
			title: parsed.title,
			content: replace ? ai.text : parsed.content,
			date: parsed.date,
			modified: new Date(entry.mtimeMs),
			now: new Date(),
			folder: folderLabel,
			route: route.name,
			filename: entry.name.replace(/\.[^.]+$/, ""),
			source: sourceKey,
			words: countWords(parsed.content),
			ai: ai.text,
			ai_title: ai.title ?? parsed.title,
		};
	}

	private makeRecord(
		route: Route,
		entry: SourceEntry,
		sourceKey: string,
		contentHash: string,
		notePath: string | null,
		bodyHash: string | null,
	): SourceRecord {
		return {
			routeId: route.id,
			sourceKey,
			sourcePath: entry.path,
			size: entry.size,
			mtimeMs: entry.mtimeMs,
			contentHash,
			notePath,
			bodyHash,
			lastSyncedAt: Date.now(),
			status: "synced",
		};
	}
}
