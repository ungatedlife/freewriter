import * as fs from "fs";
import * as path from "path";
import { App, Notice, PluginSettingTab, Setting, parseYaml } from "obsidian";
import { frontMatterYaml, splitFrontMatter } from "../frontmatter";
import type BridgePlugin from "../main";
import { UPDATE_POLICY_LABELS, newRoute, type AdapterId, type Route, type UpdatePolicy } from "../settings";
import { FolderSuggest } from "./folder-suggest";

type View = { kind: "list" } | { kind: "route"; id: string } | { kind: "advanced" };

const POLICY_SHORT: Record<UpdatePolicy, string> = {
	sync: "syncs until you edit it",
	overwrite: "always overwrites",
	once: "imports once",
};

/**
 * Two levels: a list page with one card per route, and a subpage per route
 * (plus one for the advanced options) reached through its Configure button.
 */
export class BridgeSettingTab extends PluginSettingTab {
	private view: View = { kind: "list" };

	constructor(
		app: App,
		private readonly plugin: BridgePlugin,
	) {
		super(app, plugin);
	}

	hide(): void {
		this.view = { kind: "list" };
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();
		const view = this.view;
		if (view.kind === "route") {
			const route = this.plugin.settings.routes.find((r) => r.id === view.id);
			if (route) {
				this.renderRoutePage(containerEl, route);
				return;
			}
			this.view = { kind: "list" };
		}
		if (view.kind === "advanced") {
			this.renderAdvancedPage(containerEl);
			return;
		}
		this.renderListPage(containerEl);
	}

	private show(view: View): void {
		this.view = view;
		this.display();
	}

	// ---------------------------------------------------------------- list page

	private renderListPage(containerEl: HTMLElement): void {
		const settings = this.plugin.settings;

		new Setting(containerEl)
			.setName("Detect Freewrite folders")
			.setDesc("Finds the Postbox folder inside Dropbox, Google Drive or OneDrive and adds one route per draft folder. New routes start disabled so you can set them up first.")
			.addButton((b) =>
				b
					.setButtonText("Detect")
					.setCta()
					.onClick(async () => {
						const n = await this.plugin.detectRoutes();
						new Notice(n ? `Added ${n} route${n === 1 ? "" : "s"}.` : "No new Postbox folders found. Add a route by hand below.");
						this.display();
					}),
			);

		new Setting(containerEl).setName("Routes").setHeading();
		if (!settings.routes.length) {
			containerEl.createEl("p", { text: "No routes yet. Detect your Freewrite folders, or add a route by hand.", cls: "bridge-muted" });
		}
		for (const route of settings.routes) this.renderRouteCard(containerEl, route);
		new Setting(containerEl).addButton((b) =>
			b.setButtonText("Add route").onClick(async () => {
				const route = newRoute({ name: `Route ${settings.routes.length + 1}` });
				settings.routes.push(route);
				await this.plugin.saveSettings();
				this.show({ kind: "route", id: route.id });
			}),
		);

		new Setting(containerEl).setName("Sync").setHeading();
		new Setting(containerEl)
			.setName("Run a sync")
			.setDesc(this.lastRunText())
			.addButton((b) =>
				b
					.setButtonText("Preview")
					.setTooltip("Lists what would be created or updated without writing anything")
					.onClick(() => void this.plugin.preview()),
			)
			.addButton((b) =>
				b.setButtonText("Sync now").onClick(async () => {
					await this.plugin.syncNow();
					this.display();
				}),
			)
			.addExtraButton((b) =>
				b
					.setIcon("list")
					.setTooltip("Show sync log")
					.onClick(() => this.plugin.showLog()),
			);

		new Setting(containerEl)
			.setName("Advanced")
			.setDesc("Identity and status properties, fallback check interval, conflict copy naming.")
			.addButton((b) => b.setButtonText("Open").onClick(() => this.show({ kind: "advanced" })));
	}

	private lastRunText(): string {
		const report = this.plugin.engine?.lastReport;
		if (!report) return "Preview lists what would be created or updated without writing anything.";
		const time = new Date(report.finishedAt);
		const stamp = `${String(time.getHours()).padStart(2, "0")}:${String(time.getMinutes()).padStart(2, "0")}`;
		const summary = this.plugin.engine.summarize(report);
		return `Last sync at ${stamp}: ${summary || "nothing to do"}.`;
	}

	private renderRouteCard(containerEl: HTMLElement, route: Route): void {
		const card = containerEl.createDiv({ cls: "bridge-card" });
		const desc = document.createDocumentFragment();
		const summary = this.routeSummary(route);
		desc.createDiv({ text: summary.line1 });
		desc.createDiv({ text: summary.line2, cls: "bridge-muted" });
		if (summary.warning) desc.createDiv({ text: summary.warning, cls: "bridge-warning" });

		new Setting(card)
			.setName(route.name || "Untitled route")
			.setDesc(desc)
			.addToggle((t) =>
				t
					.setTooltip("Enabled")
					.setValue(route.enabled)
					.onChange(async (v) => {
						if (v && !route.sourcePath) {
							new Notice("Set a source folder first.");
							t.setValue(false);
							return;
						}
						route.enabled = v;
						await this.plugin.saveSettings();
					}),
			)
			.addButton((b) => b.setButtonText("Configure").onClick(() => this.show({ kind: "route", id: route.id })));
	}

	private routeSummary(route: Route): { line1: string; line2: string; warning: string | null } {
		if (!route.sourcePath) {
			return {
				line1: "Not set up yet.",
				line2: "Open Configure to choose a source folder and a destination.",
				warning: null,
			};
		}
		const source = `${path.basename(path.dirname(route.sourcePath))}/${path.basename(route.sourcePath)}`;
		const destination = route.destination || "vault root";
		return {
			line1: `${source}  →  ${destination}`,
			line2: `Notes named “${route.filenameTemplate}” · ${POLICY_SHORT[route.updatePolicy]}`,
			warning: fs.existsSync(route.sourcePath) ? null : "Source folder not found on this computer.",
		};
	}

	// --------------------------------------------------------------- route page

	private renderRoutePage(containerEl: HTMLElement, route: Route): void {
		const settings = this.plugin.settings;
		const save = (): Promise<void> => this.plugin.saveSettings();

		const heading = new Setting(containerEl)
			.setName(route.name || "Untitled route")
			.setHeading()
			.addButton((b) => b.setButtonText("Back to routes").onClick(() => this.show({ kind: "list" })));
		heading.settingEl.addClass("bridge-subpage-header");

		new Setting(containerEl)
			.setName("Enabled")
			.setDesc("Watch the source folder and keep its drafts in the vault.")
			.addToggle((t) =>
				t.setValue(route.enabled).onChange(async (v) => {
					if (v && !route.sourcePath) {
						new Notice("Set a source folder first.");
						t.setValue(false);
						return;
					}
					route.enabled = v;
					await save();
				}),
			);

		new Setting(containerEl)
			.setName("Name")
			.setDesc("Shown in the route list and the sync log.")
			.addText((t) =>
				t.setValue(route.name).onChange(async (v) => {
					route.name = v;
					heading.setName(v || "Untitled route");
					await save();
				}),
			);

		const sourceSetting = new Setting(containerEl)
			.setName("Source folder")
			.setDesc("Folder on this computer that Postbox syncs to, for example …/Dropbox/Apps/Postbox/A.");
		sourceSetting.settingEl.addClass("bridge-stack");
		sourceSetting
			.addText((t) => {
				t.setPlaceholder("/Users/you/Library/CloudStorage/Dropbox/Apps/Postbox/A")
					.setValue(route.sourcePath)
					.onChange(async (v) => {
						route.sourcePath = v.trim();
						await save();
					});
			})
			.addExtraButton((b) =>
				b
					.setIcon("folder-open")
					.setTooltip("Choose folder")
					.onClick(async () => {
						const picked = await pickFolder();
						if (picked) {
							route.sourcePath = picked;
							await save();
							this.display();
						}
					}),
			);

		const destinationSetting = new Setting(containerEl)
			.setName("Destination folder in vault")
			.setDesc("Notes from this route are created here. Move them anywhere afterwards; the link survives.");
		destinationSetting.settingEl.addClass("bridge-stack");
		destinationSetting.addText((t) => {
			new FolderSuggest(this.app, t.inputEl);
			t.setPlaceholder("Freewrite/A")
				.setValue(route.destination)
				.onChange(async (v) => {
					route.destination = v.trim().replace(/^\/+|\/+$/g, "");
					await save();
				});
		});

		new Setting(containerEl).setName("Notes").setHeading();

		new Setting(containerEl)
			.setName("Source format")
			.setDesc("Postbox reads the date from the file name and treats a short first line as the title. Generic imports any folder of .md or .txt files.")
			.addDropdown((d) =>
				d
					.addOption("postbox", "Freewrite Postbox")
					.addOption("generic", "Generic files")
					.setValue(route.adapter)
					.onChange(async (v) => {
						route.adapter = v as AdapterId;
						await save();
					}),
			);

		const filenameSetting = new Setting(containerEl)
			.setName("Note file name")
			.setDesc("Variables: {{title}}, {{date}}, {{date:M-D-YYYY}}, {{folder}}, {{filename}}.");
		filenameSetting.settingEl.addClass("bridge-stack");
		filenameSetting.addText((t) => {
			t.setValue(route.filenameTemplate).onChange(async (v) => {
				route.filenameTemplate = v.trim() || "{{title}}";
				await save();
			});
		});

		const templateSetting = new Setting(containerEl)
			.setName("Note template")
			.setDesc(
				"The whole note, front matter included. {{content}} becomes the draft text. Also: {{title}}, {{date}}, {{modified}}, {{now}}, {{folder}}, {{route}}, {{source}}, {{words}}. Dates take moment formats, e.g. {{date:dddd, MMMM D}}.",
			);
		templateSetting.settingEl.addClass("bridge-stack");
		templateSetting.settingEl.addClass("bridge-template");
		const warning = templateSetting.descEl.createDiv({ cls: "bridge-template-warning" });
		const showWarning = (template: string): void => {
			const err = validateTemplate(template);
			warning.setText(err ? `Front matter is not valid YAML: ${err}` : "");
		};
		showWarning(route.noteTemplate);
		templateSetting.addTextArea((t) => {
			t.inputEl.rows = 10;
			t.setValue(route.noteTemplate).onChange(async (v) => {
				route.noteTemplate = v;
				showWarning(v);
				await save();
			});
		});

		new Setting(containerEl).setName("Updates").setHeading();

		new Setting(containerEl)
			.setName("When the draft changes")
			.setDesc("With the first option Bridge overwrites the body until you edit the note in Obsidian; after that, new versions land in a copy beside it.")
			.addDropdown((d) => {
				for (const [key, label] of Object.entries(UPDATE_POLICY_LABELS)) d.addOption(key, label);
				d.setValue(route.updatePolicy).onChange(async (v) => {
					route.updatePolicy = v as UpdatePolicy;
					await save();
				});
			});

		new Setting(containerEl)
			.setName("Leave the title line out of the body")
			.setDesc("When a draft starts with a short title line, the note name carries it and the body starts with the text below.")
			.addToggle((t) =>
				t.setValue(route.stripTitleLine).onChange(async (v) => {
					route.stripTitleLine = v;
					await save();
				}),
			);

		new Setting(containerEl)
			.setName("Remove this route")
			.setDesc("Notes already in the vault are kept. Bridge just stops watching this folder.")
			.addButton((b) => {
				let armed = false;
				b.setButtonText("Remove")
					.setWarning()
					.onClick(async () => {
						if (!armed) {
							armed = true;
							b.setButtonText("Click again to remove");
							return;
						}
						settings.routes = settings.routes.filter((r) => r.id !== route.id);
						await save();
						this.show({ kind: "list" });
					});
			});
	}

	// ------------------------------------------------------------ advanced page

	private renderAdvancedPage(containerEl: HTMLElement): void {
		const settings = this.plugin.settings;
		const save = (): Promise<void> => this.plugin.saveSettings();

		const heading = new Setting(containerEl)
			.setName("Advanced")
			.setHeading()
			.addButton((b) => b.setButtonText("Back").onClick(() => this.show({ kind: "list" })));
		heading.settingEl.addClass("bridge-subpage-header");

		new Setting(containerEl)
			.setName("Identity property")
			.setDesc("Front matter property that links a note to its draft. Rename or move the note freely; the link survives.")
			.addText((t) =>
				t.setValue(settings.identityProperty).onChange(async (v) => {
					settings.identityProperty = v.trim() || "bridge_source";
					await save();
				}),
			);

		new Setting(containerEl)
			.setName("Status property")
			.setDesc("Set to source-missing when a draft disappears from its folder, and to detached when a note stops following its draft.")
			.addText((t) =>
				t.setValue(settings.statusProperty).onChange(async (v) => {
					settings.statusProperty = v.trim() || "bridge_status";
					await save();
				}),
			);

		new Setting(containerEl)
			.setName("Flag notes whose draft disappeared")
			.setDesc("Notes are never deleted. This only sets the status property so you can find them.")
			.addToggle((t) =>
				t.setValue(settings.markMissingSources).onChange(async (v) => {
					settings.markMissingSources = v;
					await save();
				}),
			);

		new Setting(containerEl)
			.setName("Full check every (minutes)")
			.setDesc("Source folders are watched live. This is the fallback check in case a change is missed.")
			.addText((t) =>
				t.setValue(String(settings.checkIntervalMinutes)).onChange(async (v) => {
					const n = Number(v);
					if (Number.isFinite(n) && n >= 1) {
						settings.checkIntervalMinutes = n;
						await save();
					}
				}),
			);

		new Setting(containerEl).setName("Sync when Obsidian starts").addToggle((t) =>
			t.setValue(settings.syncOnStartup).onChange(async (v) => {
				settings.syncOnStartup = v;
				await save();
			}),
		);

		new Setting(containerEl)
			.setName("Conflict copy suffix")
			.setDesc("Added to the note name when a new version of a draft arrives after you edited the note in Obsidian. Template variables work here.")
			.addText((t) =>
				t.setValue(settings.conflictSuffixTemplate).onChange(async (v) => {
					settings.conflictSuffixTemplate = v.trim() || "(updated {{modified:YYYY-MM-DD HH-mm}})";
					await save();
				}),
			);
	}
}

function validateTemplate(template: string): string | null {
	const { frontmatter } = splitFrontMatter(template);
	if (!frontmatter) return null;
	const probe = frontMatterYaml(frontmatter).replace(/\{\{[^}]*\}\}/g, "x");
	try {
		parseYaml(probe);
		return null;
	} catch (e) {
		return e instanceof Error ? e.message : String(e);
	}
}

interface OpenDialogResult {
	canceled: boolean;
	filePaths: string[];
}

interface ElectronDialog {
	showOpenDialog(options: { properties: string[] }): Promise<OpenDialogResult>;
}

async function pickFolder(): Promise<string | null> {
	try {
		const fromWindow = (window as unknown as { electron?: { remote?: { dialog?: ElectronDialog } } }).electron?.remote?.dialog;
		const fromRequire = (require("electron") as { remote?: { dialog?: ElectronDialog } }).remote?.dialog;
		const dialog = fromWindow ?? fromRequire;
		if (!dialog) {
			new Notice("The folder picker is not available here; paste the path instead.");
			return null;
		}
		const result = await dialog.showOpenDialog({ properties: ["openDirectory"] });
		return result.canceled || !result.filePaths.length ? null : result.filePaths[0];
	} catch {
		new Notice("The folder picker failed; paste the path instead.");
		return null;
	}
}
