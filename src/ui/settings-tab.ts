import { App, Notice, PluginSettingTab, Setting, parseYaml } from "obsidian";
import { frontMatterYaml, splitFrontMatter } from "../frontmatter";
import type BridgePlugin from "../main";
import { UPDATE_POLICY_LABELS, newRoute, type AdapterId, type Route, type UpdatePolicy } from "../settings";
import { FolderSuggest } from "./folder-suggest";

export class BridgeSettingTab extends PluginSettingTab {
	constructor(
		app: App,
		private readonly plugin: BridgePlugin,
	) {
		super(app, plugin);
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();
		const settings = this.plugin.settings;

		new Setting(containerEl)
			.setName("Detect Freewrite folders")
			.setDesc(
				"Looks for a Postbox folder inside Dropbox, Google Drive or OneDrive and adds one route per draft folder (A, B, C). New routes start disabled so you can set their templates first.",
			)
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

		new Setting(containerEl)
			.setName("Run a sync")
			.setDesc("Preview lists what would be created or updated without writing anything.")
			.addButton((b) => b.setButtonText("Preview").onClick(() => void this.plugin.preview()))
			.addButton((b) => b.setButtonText("Sync now").onClick(() => void this.plugin.syncNow()));

		new Setting(containerEl).setName("Routes").setHeading();
		if (!settings.routes.length) {
			containerEl.createEl("p", { text: "No routes yet.", cls: "bridge-muted" });
		}
		settings.routes.forEach((route, i) => this.renderRoute(containerEl, route, i));
		new Setting(containerEl).addButton((b) =>
			b.setButtonText("Add route").onClick(async () => {
				settings.routes.push(newRoute({ name: `Route ${settings.routes.length + 1}` }));
				await this.plugin.saveSettings();
				this.display();
			}),
		);

		new Setting(containerEl).setName("Behavior").setHeading();

		new Setting(containerEl)
			.setName("Identity property")
			.setDesc("Front matter property that links a note to its draft. Rename or move the note freely; the link survives.")
			.addText((t) =>
				t.setValue(settings.identityProperty).onChange(async (v) => {
					settings.identityProperty = v.trim() || "bridge_source";
					await this.plugin.saveSettings();
				}),
			);

		new Setting(containerEl)
			.setName("Status property")
			.setDesc("Set to source-missing when a draft disappears from its folder, and to detached when a note stops following its draft.")
			.addText((t) =>
				t.setValue(settings.statusProperty).onChange(async (v) => {
					settings.statusProperty = v.trim() || "bridge_status";
					await this.plugin.saveSettings();
				}),
			);

		new Setting(containerEl)
			.setName("Flag notes whose draft disappeared")
			.setDesc("Notes are never deleted. This only sets the status property so you can find them.")
			.addToggle((t) =>
				t.setValue(settings.markMissingSources).onChange(async (v) => {
					settings.markMissingSources = v;
					await this.plugin.saveSettings();
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
						await this.plugin.saveSettings();
					}
				}),
			);

		new Setting(containerEl)
			.setName("Sync when Obsidian starts")
			.addToggle((t) =>
				t.setValue(settings.syncOnStartup).onChange(async (v) => {
					settings.syncOnStartup = v;
					await this.plugin.saveSettings();
				}),
			);

		new Setting(containerEl)
			.setName("Conflict copy suffix")
			.setDesc("Added to the note name when a new version of a draft arrives after you edited the note in Obsidian. Template variables work here.")
			.addText((t) =>
				t.setValue(settings.conflictSuffixTemplate).onChange(async (v) => {
					settings.conflictSuffixTemplate = v.trim() || "(updated {{modified:YYYY-MM-DD HH-mm}})";
					await this.plugin.saveSettings();
				}),
			);
	}

	private renderRoute(containerEl: HTMLElement, route: Route, index: number): void {
		const settings = this.plugin.settings;
		const save = (): Promise<void> => this.plugin.saveSettings();
		const box = containerEl.createDiv({ cls: "bridge-route" });

		new Setting(box)
			.setName(route.name || `Route ${index + 1}`)
			.setDesc(route.sourcePath ? `${route.sourcePath} → ${route.destination || "vault root"}` : "Set a source folder and a destination, then enable the route.")
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
						await save();
					}),
			)
			.addExtraButton((b) =>
				b
					.setIcon("trash")
					.setTooltip("Remove route")
					.onClick(async () => {
						settings.routes.splice(index, 1);
						await save();
						this.display();
					}),
			);

		new Setting(box).setName("Name").addText((t) =>
			t.setValue(route.name).onChange(async (v) => {
				route.name = v;
				await save();
			}),
		);

		const sourceSetting = new Setting(box)
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

		const destinationSetting = new Setting(box)
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

		new Setting(box)
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

		const filenameSetting = new Setting(box)
			.setName("Note file name")
			.setDesc("Template for the note name. Variables: {{title}}, {{date}}, {{date:M-D-YYYY}}, {{folder}}, {{filename}}.");
		filenameSetting.settingEl.addClass("bridge-stack");
		filenameSetting.addText((t) => {
				t.setValue(route.filenameTemplate).onChange(async (v) => {
					route.filenameTemplate = v.trim() || "{{title}}";
					await save();
				});
			});

		const templateSetting = new Setting(box)
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

		new Setting(box)
			.setName("When the draft changes")
			.setDesc("With the first option Bridge overwrites the body until you edit the note in Obsidian; after that, new versions land in a copy beside it.")
			.addDropdown((d) => {
				for (const [key, label] of Object.entries(UPDATE_POLICY_LABELS)) d.addOption(key, label);
				d.setValue(route.updatePolicy).onChange(async (v) => {
					route.updatePolicy = v as UpdatePolicy;
					await save();
				});
			});

		new Setting(box)
			.setName("Leave the title line out of the body")
			.setDesc("When a draft starts with a short title line, the note name carries it and the body starts with the text below.")
			.addToggle((t) =>
				t.setValue(route.stripTitleLine).onChange(async (v) => {
					route.stripTitleLine = v;
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
