import * as fs from "fs";
import * as path from "path";
import { App, Notice, PluginSettingTab, Setting } from "obsidian";
import { formatLocalDateTime, parseLocalDateTime } from "../dates";
import type FreewriterPlugin from "../main";
import {
	AI_PLACEMENT_LABELS,
	PROPERTY_TYPE_LABELS,
	UPDATE_POLICY_LABELS,
	newRoute,
	type AiPlacement,
	type PropertySpec,
	type PropertyType,
	type Route,
	type UpdatePolicy,
} from "../settings";
import { isTruthy, splitListValue } from "../yaml";
import { FolderSuggest } from "./folder-suggest";
import { StringSuggest } from "./string-suggest";

type View = { kind: "list" } | { kind: "route"; id: string } | { kind: "ai" } | { kind: "advanced" };

interface VaultPropertyInfo {
	type: PropertyType;
	values: string[];
}

const POLICY_SHORT: Record<UpdatePolicy, string> = {
	sync: "syncs until you edit it",
	overwrite: "always overwrites",
	once: "imports once",
};

const DATE_LIKE = /^\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2}(?::\d{2})?)?$/;
const VARIABLES_HINT = "Values can use {{date}}, {{date:M-D-YYYY}}, {{title}}, {{ai_title}}, {{modified}}, {{now}}, {{folder}}, {{route}}, {{source}} and {{words}}.";

/**
 * Two levels: a list page with one card per route, and subpages for each route,
 * the AI connection and the advanced options.
 */
export class FreewriterSettingTab extends PluginSettingTab {
	private view: View = { kind: "list" };

	constructor(
		app: App,
		private readonly plugin: FreewriterPlugin,
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
		if (view.kind === "ai") {
			this.renderAiPage(containerEl);
			return;
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

	private save(): Promise<void> {
		return this.plugin.saveSettings();
	}

	private subpageHeader(containerEl: HTMLElement, title: string): Setting {
		const heading = new Setting(containerEl)
			.setName(title)
			.setHeading()
			.addButton((b) => b.setButtonText("Back").onClick(() => this.show({ kind: "list" })));
		heading.settingEl.addClass("fw-subpage-header");
		return heading;
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
						new Notice(
							n
								? `Added ${n} route${n === 1 ? "" : "s"}. They import drafts written from now on; open Configure to include older ones.`
								: "No new Postbox folders found. Add a route by hand below.",
						);
						this.display();
					}),
			);

		new Setting(containerEl).setName("Routes").setHeading();
		if (!settings.routes.length) {
			containerEl.createEl("p", { text: "No routes yet. Detect your Freewrite folders, or add a route by hand.", cls: "fw-muted" });
		}
		for (const route of settings.routes) this.renderRouteCard(containerEl, route);
		new Setting(containerEl).addButton((b) =>
			b.setButtonText("Add route").onClick(async () => {
				const route = newRoute({ name: `Route ${settings.routes.length + 1}` });
				settings.routes.push(route);
				await this.save();
				this.show({ kind: "route", id: route.id });
			}),
		);

		new Setting(containerEl).setName("Sync").setHeading();
		const syncRow = new Setting(containerEl).setName("Run a sync").setDesc(this.lastRunText());
		if (this.plugin.engine?.isRunning) {
			syncRow.addButton((b) =>
				b
					.setButtonText("Stop")
					.setWarning()
					.onClick(() => {
						this.plugin.engine.stop();
						new Notice("Freewriter: stopping after the current draft.");
					}),
			);
		}
		syncRow
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

		const aiRoutes = settings.routes.filter((r) => r.ai.enabled).length;
		new Setting(containerEl)
			.setName("AI formatting")
			.setDesc(
				settings.openRouterApiKey.trim()
					? `OpenRouter connected · model ${settings.openRouterModel} · used by ${aiRoutes} route${aiRoutes === 1 ? "" : "s"}.`
					: "Connect OpenRouter to let routes summarize, format or title drafts with a model of your choice.",
			)
			.addButton((b) => b.setButtonText("Open").onClick(() => this.show({ kind: "ai" })));

		new Setting(containerEl)
			.setName("Advanced")
			.setDesc("Identity and status properties, fallback check interval, conflict copy naming.")
			.addButton((b) => b.setButtonText("Open").onClick(() => this.show({ kind: "advanced" })));
	}

	private lastRunText(): string {
		if (this.plugin.engine?.isRunning) return "A sync is running. Stop ends it after the draft being processed.";
		const report = this.plugin.engine?.lastReport;
		if (!report) return "Preview lists what would be created or updated without writing anything.";
		const time = new Date(report.finishedAt);
		const stamp = `${String(time.getHours()).padStart(2, "0")}:${String(time.getMinutes()).padStart(2, "0")}`;
		const summary = this.plugin.engine.summarize(report);
		return `Last sync at ${stamp}: ${summary || "nothing to do"}.`;
	}

	private renderRouteCard(containerEl: HTMLElement, route: Route): void {
		const card = containerEl.createDiv({ cls: "fw-card" });
		const desc = document.createDocumentFragment();
		const summary = this.routeSummary(route);
		desc.createDiv({ text: summary.line1 });
		desc.createDiv({ text: summary.line2, cls: "fw-muted" });
		if (summary.warning) desc.createDiv({ text: summary.warning, cls: "fw-warning" });

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
						await this.save();
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
		const props = route.properties.filter((p) => p.key.trim()).length;
		const bits = [`Named “${route.filenameTemplate}”`, `${props} propert${props === 1 ? "y" : "ies"}`, POLICY_SHORT[route.updatePolicy]];
		if (route.ai.enabled) bits.push("AI on");
		bits.push(route.sinceMs === null ? "imports the whole folder" : `only drafts changed after ${formatLocalDateTime(route.sinceMs)}`);
		return {
			line1: `${source}  →  ${destination}`,
			line2: bits.join(" · "),
			warning: fs.existsSync(route.sourcePath) ? null : "Source folder not found on this computer.",
		};
	}

	// --------------------------------------------------------------- route page

	private renderRoutePage(containerEl: HTMLElement, route: Route): void {
		const settings = this.plugin.settings;
		const heading = this.subpageHeader(containerEl, route.name || "Untitled route");

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
					await this.save();
				}),
			);

		new Setting(containerEl)
			.setName("Name")
			.setDesc("Shown in the route list and the sync log.")
			.addText((t) =>
				t.setValue(route.name).onChange(async (v) => {
					route.name = v;
					heading.setName(v || "Untitled route");
					await this.save();
				}),
			);

		const cutoff = new Setting(containerEl)
			.setName("Ignore drafts changed before")
			.setDesc("Only drafts changed after this moment are imported. Drafts already in the vault keep syncing regardless. Leave empty to import everything in the folder.");
		const cutoffWarning = cutoff.descEl.createDiv({ cls: "fw-template-warning" });
		cutoff
			.addText((t) => {
				t.setPlaceholder("YYYY-MM-DD or YYYY-MM-DD HH:mm")
					.setValue(route.sinceMs === null ? "" : formatLocalDateTime(route.sinceMs))
					.onChange(async (v) => {
						if (!v.trim()) {
							route.sinceMs = null;
							cutoffWarning.setText("");
							await this.save();
							return;
						}
						const parsed = parseLocalDateTime(v);
						if (parsed === null) {
							cutoffWarning.setText("Use YYYY-MM-DD, optionally followed by HH:mm.");
							return;
						}
						cutoffWarning.setText("");
						route.sinceMs = parsed;
						await this.save();
					});
			})
			.addExtraButton((b) =>
				b
					.setIcon("clock")
					.setTooltip("Skip everything currently in the folder")
					.onClick(async () => {
						route.sinceMs = Date.now();
						await this.save();
						this.display();
					}),
			);

		const sourceSetting = new Setting(containerEl)
			.setName("Source folder")
			.setDesc("Folder on this computer that Postbox syncs to, for example …/Dropbox/Apps/Postbox/A.");
		sourceSetting.settingEl.addClass("fw-stack");
		sourceSetting
			.addText((t) => {
				t.setPlaceholder("/Users/you/Library/CloudStorage/Dropbox/Apps/Postbox/A")
					.setValue(route.sourcePath)
					.onChange(async (v) => {
						route.sourcePath = v.trim();
						await this.save();
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
							await this.save();
							this.display();
						}
					}),
			);

		const destinationSetting = new Setting(containerEl)
			.setName("Destination folder in vault")
			.setDesc("Notes from this route are created here. Move them anywhere afterwards; the link survives.");
		destinationSetting.settingEl.addClass("fw-stack");
		destinationSetting.addText((t) => {
			new FolderSuggest(this.app, t.inputEl);
			t.setPlaceholder("Freewrite/A")
				.setValue(route.destination)
				.onChange(async (v) => {
					route.destination = v.trim().replace(/^\/+|\/+$/g, "");
					await this.save();
				});
		});

		new Setting(containerEl).setName("Notes").setHeading();

		const filenameSetting = new Setting(containerEl)
			.setName("Note file name")
			.setDesc("Variables: {{title}}, {{ai_title}}, {{date}}, {{date:M-D-YYYY}}, {{folder}}, {{filename}}.");
		filenameSetting.settingEl.addClass("fw-stack");
		filenameSetting.addText((t) => {
			t.setValue(route.filenameTemplate).onChange(async (v) => {
				route.filenameTemplate = v.trim() || "{{title}}";
				await this.save();
			});
		});

		this.renderProperties(containerEl, route);

		const bodySetting = new Setting(containerEl)
			.setName("Body")
			.setDesc("What goes below the properties. {{content}} is the draft text. Add {{ai}} to place the AI result yourself; otherwise it goes where the AI section says.");
		bodySetting.settingEl.addClass("fw-stack");
		bodySetting.addTextArea((t) => {
			t.inputEl.rows = 4;
			t.setValue(route.bodyTemplate).onChange(async (v) => {
				route.bodyTemplate = v;
				await this.save();
			});
		});

		new Setting(containerEl).setName("Updates").setHeading();

		new Setting(containerEl)
			.setName("When the draft changes")
			.setDesc("With the first option Freewriter overwrites the body until you edit the note in Obsidian; after that, new versions land in a copy beside it.")
			.addDropdown((d) => {
				for (const [key, label] of Object.entries(UPDATE_POLICY_LABELS)) d.addOption(key, label);
				d.setValue(route.updatePolicy).onChange(async (v) => {
					route.updatePolicy = v as UpdatePolicy;
					await this.save();
				});
			});

		new Setting(containerEl)
			.setName("Leave the title line out of the body")
			.setDesc("When a draft starts with a short title line, the note name carries it and the body starts with the text below.")
			.addToggle((t) =>
				t.setValue(route.stripTitleLine).onChange(async (v) => {
					route.stripTitleLine = v;
					await this.save();
				}),
			);

		this.renderRouteAi(containerEl, route);

		new Setting(containerEl)
			.setName("Remove this route")
			.setDesc("Notes already in the vault are kept. Freewriter just stops watching this folder.")
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
						await this.save();
						this.show({ kind: "list" });
					});
			});
	}

	// ------------------------------------------------------------- properties

	private renderProperties(containerEl: HTMLElement, route: Route): void {
		new Setting(containerEl)
			.setName("Properties")
			.setDesc(`Front matter added to every note from this route. Names and values are suggested from your vault. ${VARIABLES_HINT}`)
			.setHeading();

		const vaultProps = this.vaultProperties();
		const list = containerEl.createDiv({ cls: "fw-props" });
		if (route.properties.length) {
			const head = list.createDiv({ cls: "fw-prop-head" });
			head.createSpan({ text: "Property" });
			head.createSpan({ text: "Type" });
			head.createSpan({ text: "Value" });
		} else {
			list.createEl("p", { text: "No properties yet. Notes will only get the identity property Freewriter needs.", cls: "fw-muted" });
		}
		route.properties.forEach((prop, index) => this.renderPropertyRow(list, route, prop, index, vaultProps));

		new Setting(containerEl).addButton((b) =>
			b.setButtonText("Add property").onClick(async () => {
				route.properties.push({ key: "", type: "text", value: "" });
				await this.save();
				this.display();
				const inputs = this.containerEl.querySelectorAll<HTMLInputElement>("input.fw-prop-key");
				inputs[inputs.length - 1]?.focus();
			}),
		);
	}

	private renderPropertyRow(list: HTMLElement, route: Route, prop: PropertySpec, index: number, vaultProps: Map<string, VaultPropertyInfo>): void {
		const settings = this.plugin.settings;
		const row = new Setting(list);
		row.settingEl.addClass("fw-prop");

		row.addText((t) => {
			t.inputEl.addClass("fw-prop-key");
			t.setPlaceholder("property").setValue(prop.key);
			t.onChange(async (v) => {
				prop.key = v.trim();
				await this.save();
			});
			const reserved = new Set([settings.identityProperty, settings.statusProperty]);
			new StringSuggest(
				this.app,
				t.inputEl,
				() => Array.from(vaultProps.keys()).filter((k) => !reserved.has(k)),
				async (picked) => {
					prop.key = picked;
					const info = vaultProps.get(picked);
					if (info && !prop.value) {
						prop.type = info.type;
						if (info.type === "date") prop.value = "{{date}}";
						if (info.type === "checkbox") prop.value = "false";
					}
					await this.save();
					this.display();
				},
				{ describe: (k) => (vaultProps.get(k) ? PROPERTY_TYPE_LABELS[vaultProps.get(k)!.type] : undefined) },
			);
		});

		row.addDropdown((d) => {
			d.selectEl.addClass("fw-prop-type");
			for (const [key, label] of Object.entries(PROPERTY_TYPE_LABELS)) d.addOption(key, label);
			d.setValue(prop.type).onChange(async (v) => {
				prop.type = v as PropertyType;
				if (prop.type === "date" && !prop.value) prop.value = "{{date}}";
				if (prop.type === "checkbox") prop.value = isTruthy(prop.value) ? "true" : "false";
				await this.save();
				this.display();
			});
		});

		if (prop.type === "checkbox") {
			row.addToggle((t) =>
				t.setValue(isTruthy(prop.value)).onChange(async (v) => {
					prop.value = v ? "true" : "false";
					await this.save();
				}),
			);
		} else {
			row.addText((t) => {
				t.inputEl.addClass("fw-prop-value");
				t.setPlaceholder(valuePlaceholder(prop.type))
					.setValue(prop.value)
					.onChange(async (v) => {
						prop.value = v;
						await this.save();
					});
				const isList = prop.type === "list";
				new StringSuggest(
					this.app,
					t.inputEl,
					() => vaultProps.get(prop.key)?.values ?? [],
					async (picked) => {
						if (isList) {
							const items = splitListValue(prop.value);
							if (!items.includes(picked)) items.push(picked);
							prop.value = items.join(", ");
						} else {
							prop.value = picked;
						}
						t.setValue(prop.value);
						await this.save();
					},
					{ queryOf: isList ? (raw) => raw.split(",").pop() ?? "" : undefined },
				);
			});
		}

		row.addExtraButton((b) =>
			b
				.setIcon("x")
				.setTooltip("Remove property")
				.onClick(async () => {
					route.properties.splice(index, 1);
					await this.save();
					this.display();
				}),
		);
	}

	/** Property names, their most common type and their values across the vault, for suggestions. */
	private vaultProperties(): Map<string, VaultPropertyInfo> {
		const counts = new Map<string, { types: Map<PropertyType, number>; values: Map<string, number> }>();
		for (const file of this.app.vault.getMarkdownFiles()) {
			const fm = this.app.metadataCache.getFileCache(file)?.frontmatter;
			if (!fm) continue;
			for (const [key, raw] of Object.entries(fm)) {
				if (key === "position") continue;
				let entry = counts.get(key);
				if (!entry) {
					entry = { types: new Map(), values: new Map() };
					counts.set(key, entry);
				}
				const type = inferPropertyType(raw);
				entry.types.set(type, (entry.types.get(type) ?? 0) + 1);
				for (const value of flattenValues(raw)) entry.values.set(value, (entry.values.get(value) ?? 0) + 1);
			}
		}
		const out = new Map<string, VaultPropertyInfo>();
		for (const [key, entry] of counts) {
			const type = Array.from(entry.types.entries()).sort((a, b) => b[1] - a[1])[0]?.[0] ?? "text";
			const values = Array.from(entry.values.entries())
				.sort((a, b) => b[1] - a[1])
				.slice(0, 40)
				.map(([v]) => v);
			out.set(key, { type, values });
		}
		return out;
	}

	// ------------------------------------------------------------- AI (route)

	private renderRouteAi(containerEl: HTMLElement, route: Route): void {
		const settings = this.plugin.settings;
		new Setting(containerEl).setName("AI").setHeading();

		const connected = settings.openRouterApiKey.trim().length > 0;
		new Setting(containerEl)
			.setName("Use AI for this route")
			.setDesc(
				connected
					? `Each new version of a draft is sent to ${settings.openRouterModel} with your instructions below.`
					: "Connect OpenRouter on the AI page first. You can prepare the instructions now.",
			)
			.addToggle((t) =>
				t.setValue(route.ai.enabled).onChange(async (v) => {
					route.ai.enabled = v;
					await this.save();
					this.display();
				}),
			);
		if (!route.ai.enabled) return;

		const instructions = new Setting(containerEl)
			.setName("Instructions")
			.setDesc("What the model should do with each draft, in your own words. The result is available as {{ai}}. Leave empty to skip formatting.");
		instructions.settingEl.addClass("fw-stack");
		instructions.addTextArea((t) => {
			t.inputEl.rows = 5;
			t.setValue(route.ai.instructions).onChange(async (v) => {
				route.ai.instructions = v;
				await this.save();
			});
		});

		new Setting(containerEl)
			.setName("Where the result goes")
			.setDesc("Ignored when the body already contains {{ai}}.")
			.addDropdown((d) => {
				for (const [key, label] of Object.entries(AI_PLACEMENT_LABELS)) d.addOption(key, label);
				d.setValue(route.ai.placement).onChange(async (v) => {
					route.ai.placement = v as AiPlacement;
					await this.save();
				});
			});

		new Setting(containerEl)
			.setName("Title drafts with AI")
			.setDesc("Asks the model for a title when a note is created. Available as {{ai_title}} in the note file name and in properties.")
			.addToggle((t) =>
				t.setValue(route.ai.title).onChange(async (v) => {
					route.ai.title = v;
					await this.save();
					this.display();
				}),
			);
		if (!route.ai.title) return;

		const titleInstructions = new Setting(containerEl)
			.setName("Title instructions")
			.setDesc("How the title should read. The model already knows to reply with the title only.");
		titleInstructions.settingEl.addClass("fw-stack");
		titleInstructions.addTextArea((t) => {
			t.inputEl.rows = 3;
			t.setValue(route.ai.titleInstructions).onChange(async (v) => {
				route.ai.titleInstructions = v;
				await this.save();
			});
		});
	}

	// ---------------------------------------------------------------- AI page

	private renderAiPage(containerEl: HTMLElement): void {
		const settings = this.plugin.settings;
		this.subpageHeader(containerEl, "AI formatting");

		containerEl.createEl("p", {
			text: "Freewriter can send drafts to a model through OpenRouter, so one key gives you access to many models. Drafts are sent only for routes where AI is switched on, and only when a note is created or updated.",
			cls: "fw-muted",
		});

		const keySetting = new Setting(containerEl)
			.setName("OpenRouter API key")
			.setDesc("Create one at openrouter.ai/keys. Stored in this plugin's settings file inside your vault.");
		keySetting.settingEl.addClass("fw-stack");
		keySetting.addText((t) => {
			t.inputEl.type = "password";
			t.inputEl.autocomplete = "off";
			t.setPlaceholder("sk-or-…")
				.setValue(settings.openRouterApiKey)
				.onChange(async (v) => {
					settings.openRouterApiKey = v.trim();
					await this.save();
				});
		});

		const modelSetting = new Setting(containerEl)
			.setName("Model")
			.setDesc("Type to search OpenRouter's model list. Loading the list needs no key.");
		modelSetting.settingEl.addClass("fw-stack");
		const status = modelSetting.descEl.createDiv({ cls: "fw-muted" });
		modelSetting
			.addText((t) => {
				t.setPlaceholder("anthropic/claude-haiku-4.5")
					.setValue(settings.openRouterModel)
					.onChange(async (v) => {
						settings.openRouterModel = v.trim();
						await this.save();
					});
				new StringSuggest(
					this.app,
					t.inputEl,
					() => (this.plugin.models ?? []).map((m) => m.id),
					async (picked) => {
						settings.openRouterModel = picked;
						t.setValue(picked);
						await this.save();
					},
					{ describe: (id) => this.plugin.models?.find((m) => m.id === id)?.name, limit: 40 },
				);
			})
			.addExtraButton((b) =>
				b
					.setIcon("refresh-cw")
					.setTooltip("Reload the model list")
					.onClick(() => void this.loadModels(status, true)),
			);
		void this.loadModels(status, false);
	}

	private async loadModels(status: HTMLElement, force: boolean): Promise<void> {
		status.setText(this.plugin.models && !force ? `${this.plugin.models.length} models available.` : "Loading models…");
		try {
			const models = await this.plugin.loadModels(force);
			status.setText(`${models.length} models available.`);
		} catch (e) {
			status.setText(`Could not load the model list (${e instanceof Error ? e.message : String(e)}). You can still type a model id.`);
		}
	}

	// ------------------------------------------------------------ advanced page

	private renderAdvancedPage(containerEl: HTMLElement): void {
		const settings = this.plugin.settings;
		this.subpageHeader(containerEl, "Advanced");

		new Setting(containerEl)
			.setName("Identity property")
			.setDesc("Front matter property that links a note to its draft. Rename or move the note freely; the link survives.")
			.addText((t) =>
				t.setValue(settings.identityProperty).onChange(async (v) => {
					settings.identityProperty = v.trim() || "freewriter_source";
					await this.save();
				}),
			);

		new Setting(containerEl)
			.setName("Status property")
			.setDesc("Set to source-missing when a draft disappears from its folder, and to detached when a note stops following its draft.")
			.addText((t) =>
				t.setValue(settings.statusProperty).onChange(async (v) => {
					settings.statusProperty = v.trim() || "freewriter_status";
					await this.save();
				}),
			);

		new Setting(containerEl)
			.setName("Flag notes whose draft disappeared")
			.setDesc("Notes are never deleted. This only sets the status property so you can find them.")
			.addToggle((t) =>
				t.setValue(settings.markMissingSources).onChange(async (v) => {
					settings.markMissingSources = v;
					await this.save();
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
						await this.save();
					}
				}),
			);

		new Setting(containerEl).setName("Sync when Obsidian starts").addToggle((t) =>
			t.setValue(settings.syncOnStartup).onChange(async (v) => {
				settings.syncOnStartup = v;
				await this.save();
			}),
		);

		new Setting(containerEl)
			.setName("Conflict copy suffix")
			.setDesc("Added to the note name when a new version of a draft arrives after you edited the note in Obsidian. Template variables work here.")
			.addText((t) =>
				t.setValue(settings.conflictSuffixTemplate).onChange(async (v) => {
					settings.conflictSuffixTemplate = v.trim() || "(updated {{modified:YYYY-MM-DD HH-mm}})";
					await this.save();
				}),
			);
	}
}

function valuePlaceholder(type: PropertyType): string {
	switch (type) {
		case "list":
			return "one, two, three";
		case "number":
			return "0";
		case "date":
			return "{{date}}";
		default:
			return "value or {{variable}}";
	}
}

function inferPropertyType(raw: unknown): PropertyType {
	if (Array.isArray(raw)) return "list";
	if (typeof raw === "boolean") return "checkbox";
	if (typeof raw === "number") return "number";
	if (typeof raw === "string" && DATE_LIKE.test(raw)) return "date";
	return "text";
}

function flattenValues(raw: unknown): string[] {
	if (Array.isArray(raw)) return raw.flatMap((item) => flattenValues(item));
	if (typeof raw === "string") return raw.trim() ? [raw] : [];
	if (typeof raw === "number" || typeof raw === "boolean") return [String(raw)];
	return [];
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
