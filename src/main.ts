import { Notice, Plugin, moment, normalizePath } from "obsidian";
import * as path from "path";
import { OpenRouterClient, listOpenRouterModels, type OpenRouterModel } from "./ai/openrouter";
import { detectPostboxRoots } from "./detect";
import { newRoute, normalizeSettings, type FreewriterSettings } from "./settings";
import { emptyState, normalizeState, type SyncState } from "./state";
import { SyncEngine } from "./sync/engine";
import { FolderWatcher } from "./sync/watcher";
import type { DateFormatter } from "./template";
import { LogModal } from "./ui/log-modal";
import { PreviewModal } from "./ui/preview-modal";
import { FreewriterSettingTab } from "./ui/settings-tab";

type MomentLike = (input?: Date | number) => { format(format: string): string };
// Obsidian re-exports moment as a namespace type, which TypeScript does not consider callable.
const momentFn = moment as unknown as MomentLike;
const formatWithMoment: DateFormatter = (date, format) => momentFn(date).format(format);

export default class FreewriterPlugin extends Plugin {
	settings: FreewriterSettings = normalizeSettings(null);
	state: SyncState = emptyState();
	engine!: SyncEngine;
	/** OpenRouter model list, loaded on demand for the settings page. */
	models: OpenRouterModel[] | null = null;
	private modelsPromise: Promise<OpenRouterModel[]> | null = null;
	private watcher!: FolderWatcher;
	private statusEl: HTMLElement | null = null;
	private intervalId: number | null = null;
	private restartTimer: number | null = null;

	async onload(): Promise<void> {
		await this.loadSettings();
		await this.loadState();

		const ai = new OpenRouterClient(() => this.settings.openRouterApiKey);
		this.engine = new SyncEngine(
			this.app,
			() => this.settings,
			() => this.state,
			() => this.saveState(),
			formatWithMoment,
			() => this.updateStatus(),
			() => (this.settings.openRouterApiKey.trim() ? ai : null),
		);
		this.watcher = new FolderWatcher((routeId) => void this.engine.run({ routeIds: [routeId] }), this.settings.debounceSeconds * 1000);

		this.statusEl = this.addStatusBarItem();
		this.statusEl.addClass("mod-clickable");
		this.statusEl.setAttribute("aria-label", "Freewriter: open the sync log");
		this.statusEl.onClickEvent(() => this.showLog());
		this.updateStatus();

		this.addSettingTab(new FreewriterSettingTab(this.app, this));
		this.addCommands();

		this.app.workspace.onLayoutReady(() => {
			this.restartWatchers();
			if (this.settings.syncOnStartup) void this.syncNow(true);
		});
	}

	onunload(): void {
		this.watcher?.close();
		if (this.intervalId !== null) window.clearInterval(this.intervalId);
		if (this.restartTimer !== null) window.clearTimeout(this.restartTimer);
	}

	private addCommands(): void {
		this.addCommand({ id: "sync-now", name: "Sync now", callback: () => void this.syncNow() });
		this.addCommand({ id: "preview-sync", name: "Preview sync (dry run)", callback: () => void this.preview() });
		this.addCommand({ id: "show-log", name: "Show sync log", callback: () => this.showLog() });
		this.addCommand({
			id: "detect-folders",
			name: "Detect Freewrite folders",
			callback: async () => {
				const n = await this.detectRoutes();
				new Notice(n ? `Freewriter: added ${n} route${n === 1 ? "" : "s"}. Review them in settings, then enable them.` : "Freewriter: no new Postbox folders found.");
			},
		});
		this.addCommand({
			id: "link-existing",
			name: "Link existing notes by file name",
			callback: async () => {
				const n = await this.engine.linkExistingByName();
				new Notice(`Freewriter: linked ${n} note${n === 1 ? "" : "s"}.`);
			},
		});
		this.addCommand({
			id: "detach-note",
			name: "Detach current note from its draft",
			checkCallback: (checking) => {
				const file = this.app.workspace.getActiveFile();
				const rec = file ? this.engine.recordForNote(file.path) : null;
				if (!file || !rec) return false;
				if (!checking) {
					void this.engine.detachNote(file, rec).then(() => {
						new Notice(`Freewriter: detached ${file.basename}. New versions of the draft will land in a new note.`);
					});
				}
				return true;
			},
		});
		this.addCommand({
			id: "reveal-source",
			name: "Reveal source draft of current note",
			checkCallback: (checking) => {
				const file = this.app.workspace.getActiveFile();
				const rec = file ? this.engine.recordForNote(file.path) : null;
				if (!file || !rec) return false;
				if (!checking) revealInFileManager(rec.sourcePath);
				return true;
			},
		});
	}

	async syncNow(quiet = false): Promise<void> {
		if (!this.settings.routes.some((r) => r.enabled)) {
			if (!quiet) new Notice("Freewriter: no routes are enabled. Set them up in the plugin settings.");
			return;
		}
		const report = await this.engine.run();
		if (!quiet) {
			const summary = this.engine.summarize(report);
			new Notice(`Freewriter: ${summary || "everything is up to date"}.`);
		}
	}

	async preview(): Promise<void> {
		if (!this.settings.routes.some((r) => r.enabled)) {
			new Notice("Freewriter: no routes are enabled. Enable a route first.");
			return;
		}
		const report = await this.engine.run({ dryRun: true });
		new PreviewModal(this.app, report, () => void this.syncNow()).open();
	}

	showLog(): void {
		new LogModal(this.app, () => this.engine.events).open();
	}

	/** Add a disabled route for every Postbox draft folder found on this computer. */
	async detectRoutes(): Promise<number> {
		const known = new Set(this.settings.routes.map((r) => normalizeDiskPath(r.sourcePath)));
		let added = 0;
		for (const root of detectPostboxRoots()) {
			for (const folder of root.folders) {
				const key = normalizeDiskPath(folder);
				if (known.has(key)) continue;
				const label = path.basename(folder);
				this.settings.routes.push(
					newRoute({ name: `Freewrite ${label}`, sourcePath: folder, destination: `Freewrite/${label}`, enabled: false }),
				);
				known.add(key);
				added++;
			}
		}
		if (added) await this.saveSettings();
		return added;
	}

	async loadModels(force = false): Promise<OpenRouterModel[]> {
		if (this.models && !force) return this.models;
		if (!this.modelsPromise) {
			this.modelsPromise = listOpenRouterModels()
				.then((models) => {
					this.models = models;
					return models;
				})
				.finally(() => {
					this.modelsPromise = null;
				});
		}
		return this.modelsPromise;
	}

	updateStatus(): void {
		if (!this.statusEl) return;
		if (this.engine?.isRunning) {
			this.statusEl.setText("Freewriter: syncing…");
			return;
		}
		const report = this.engine?.lastReport;
		if (!report) {
			this.statusEl.setText("Freewriter");
			return;
		}
		const time = momentFn(report.finishedAt).format("HH:mm");
		const conflicts = Object.values(this.state.records).filter((r) => r.status === "conflict").length;
		if (report.counts.error) {
			this.statusEl.setText(`Freewriter: ${report.counts.error} error${report.counts.error === 1 ? "" : "s"}`);
		} else if (conflicts) {
			this.statusEl.setText(`Freewriter ${time} · ${conflicts} conflict${conflicts === 1 ? "" : "s"}`);
		} else {
			this.statusEl.setText(`Freewriter ${time}`);
		}
	}

	restartWatchers(): void {
		this.watcher.close();
		this.watcher.setDebounce(this.settings.debounceSeconds * 1000);
		for (const route of this.settings.routes) {
			if (!route.enabled || !route.sourcePath) continue;
			if (!this.watcher.watch(route.id, route.sourcePath)) {
				this.engine.log("warn", route.name, `Cannot watch ${route.sourcePath}; relying on the periodic check.`);
			}
		}
		if (this.intervalId !== null) window.clearInterval(this.intervalId);
		const minutes = Math.max(1, this.settings.checkIntervalMinutes);
		this.intervalId = window.setInterval(() => void this.syncNow(true), minutes * 60_000);
		this.registerInterval(this.intervalId);
	}

	async loadSettings(): Promise<void> {
		this.settings = normalizeSettings(await this.loadData());
	}

	async saveSettings(): Promise<void> {
		await this.saveData(this.settings);
		if (this.restartTimer !== null) window.clearTimeout(this.restartTimer);
		this.restartTimer = window.setTimeout(() => {
			this.restartTimer = null;
			this.restartWatchers();
		}, 800);
	}

	private statePath(): string {
		const dir = this.manifest.dir ?? `${this.app.vault.configDir}/plugins/${this.manifest.id}`;
		return normalizePath(`${dir}/state.json`);
	}

	async loadState(): Promise<void> {
		try {
			const p = this.statePath();
			if (await this.app.vault.adapter.exists(p)) {
				this.state = normalizeState(JSON.parse(await this.app.vault.adapter.read(p)));
			}
		} catch (e) {
			console.error("Freewriter: could not read state.json, starting with an empty state", e);
			this.state = emptyState();
		}
	}

	async saveState(): Promise<void> {
		await this.app.vault.adapter.write(this.statePath(), JSON.stringify(this.state, null, "\t"));
	}
}

function normalizeDiskPath(p: string): string {
	return p.replace(/[\\/]+$/, "").toLowerCase();
}

function revealInFileManager(filePath: string): void {
	try {
		const electron = require("electron") as { shell?: { showItemInFolder: (p: string) => void } };
		if (electron.shell) {
			electron.shell.showItemInFolder(filePath);
			return;
		}
	} catch {
		// not running inside Electron
	}
	new Notice(`Source draft: ${filePath}`);
}
