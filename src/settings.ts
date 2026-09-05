import { frontMatterYaml, splitFrontMatter } from "./frontmatter";
import { parseSimpleYaml } from "./yaml";

export type UpdatePolicy = "sync" | "overwrite" | "once";
export type AdapterId = "postbox" | "generic";
export type PropertyType = "text" | "list" | "number" | "checkbox" | "date";
export type AiPlacement = "above" | "below" | "replace";

/** One front matter property added to every note a route creates. Values may use {{variables}}. */
export interface PropertySpec {
	key: string;
	type: PropertyType;
	value: string;
}

export interface RouteAi {
	enabled: boolean;
	/** What the model should do with each draft; the result is available as {{ai}}. */
	instructions: string;
	placement: AiPlacement;
	/** Ask the model for a title, available as {{ai_title}}. */
	title: boolean;
	titleInstructions: string;
}

export interface Route {
	id: string;
	name: string;
	enabled: boolean;
	/** Absolute path of the folder on disk that Postbox syncs to. */
	sourcePath: string;
	/** Vault folder the notes are written to ("" means the vault root). */
	destination: string;
	adapter: AdapterId;
	filenameTemplate: string;
	properties: PropertySpec[];
	/** Body of the note; {{content}} is the draft text. */
	bodyTemplate: string;
	updatePolicy: UpdatePolicy;
	stripTitleLine: boolean;
	ai: RouteAi;
}

export interface FreewriterSettings {
	settingsVersion: number;
	routes: Route[];
	identityProperty: string;
	statusProperty: string;
	checkIntervalMinutes: number;
	debounceSeconds: number;
	markMissingSources: boolean;
	conflictSuffixTemplate: string;
	syncOnStartup: boolean;
	openRouterApiKey: string;
	openRouterModel: string;
}

export const DEFAULT_MODEL = "anthropic/claude-haiku-4.5";
export const DEFAULT_BODY_TEMPLATE = "{{content}}";
export const DEFAULT_AI_INSTRUCTIONS =
	"Write a short bullet-point summary of the key ideas in this draft, using the writer's own words where possible. Do not rewrite or comment on the draft.";
export const DEFAULT_AI_TITLE_INSTRUCTIONS = "Write a concise, descriptive title of at most eight words for this draft.";

export const PROPERTY_TYPE_LABELS: Record<PropertyType, string> = {
	text: "Text",
	list: "List",
	number: "Number",
	checkbox: "Checkbox",
	date: "Date",
};

export const AI_PLACEMENT_LABELS: Record<AiPlacement, string> = {
	above: "Above the draft",
	below: "Below the draft",
	replace: "Instead of the draft",
};

export const UPDATE_POLICY_LABELS: Record<UpdatePolicy, string> = {
	sync: "Keep in sync until I edit it here",
	overwrite: "Always overwrite the body",
	once: "Import once, never update",
};

export function defaultProperties(): PropertySpec[] {
	return [
		{ key: "date", type: "date", value: "{{date}}" },
		{ key: "tags", type: "list", value: "freewrite" },
	];
}

export function defaultAi(): RouteAi {
	return {
		enabled: false,
		instructions: DEFAULT_AI_INSTRUCTIONS,
		placement: "above",
		title: false,
		titleInstructions: DEFAULT_AI_TITLE_INSTRUCTIONS,
	};
}

export const DEFAULT_SETTINGS: FreewriterSettings = {
	settingsVersion: 2,
	routes: [],
	identityProperty: "freewriter_source",
	statusProperty: "freewriter_status",
	checkIntervalMinutes: 10,
	debounceSeconds: 2,
	markMissingSources: true,
	conflictSuffixTemplate: "(updated {{modified:YYYY-MM-DD HH-mm}})",
	syncOnStartup: true,
	openRouterApiKey: "",
	openRouterModel: DEFAULT_MODEL,
};

export function randomId(): string {
	return Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
}

export function newRoute(partial: Partial<Route> = {}): Route {
	return {
		id: randomId(),
		name: "New route",
		enabled: false,
		sourcePath: "",
		destination: "Freewrite",
		adapter: "postbox",
		filenameTemplate: "{{title}}",
		properties: defaultProperties(),
		bodyTemplate: DEFAULT_BODY_TEMPLATE,
		updatePolicy: "sync",
		stripTitleLine: true,
		ai: defaultAi(),
		...partial,
	};
}

const PROPERTY_TYPES: readonly PropertyType[] = ["text", "list", "number", "checkbox", "date"];
const PLACEMENTS: readonly AiPlacement[] = ["above", "below", "replace"];
const POLICIES: readonly UpdatePolicy[] = ["sync", "overwrite", "once"];

function isPropertyType(v: unknown): v is PropertyType {
	return PROPERTY_TYPES.includes(v as PropertyType);
}

function normalizeProperties(raw: unknown): PropertySpec[] | null {
	if (!Array.isArray(raw)) return null;
	const out: PropertySpec[] = [];
	for (const item of raw) {
		if (!item || typeof item !== "object") continue;
		const p = item as Partial<PropertySpec>;
		if (typeof p.key !== "string") continue;
		out.push({ key: p.key, type: isPropertyType(p.type) ? p.type : "text", value: typeof p.value === "string" ? p.value : "" });
	}
	return out;
}

function normalizeAi(raw: unknown): RouteAi {
	const d = defaultAi();
	if (!raw || typeof raw !== "object") return d;
	const a = raw as Partial<RouteAi>;
	return {
		enabled: a.enabled === true,
		instructions: typeof a.instructions === "string" ? a.instructions : d.instructions,
		placement: PLACEMENTS.includes(a.placement as AiPlacement) ? (a.placement as AiPlacement) : d.placement,
		title: a.title === true,
		titleInstructions: typeof a.titleInstructions === "string" ? a.titleInstructions : d.titleInstructions,
	};
}

/** Turn a template written before the properties editor existed into properties plus a body template. */
export function migrateLegacyTemplate(template: string): { properties: PropertySpec[]; bodyTemplate: string } {
	const { frontmatter, body } = splitFrontMatter(template);
	const properties: PropertySpec[] = [];
	if (frontmatter) {
		for (const entry of parseSimpleYaml(frontMatterYaml(frontmatter))) {
			properties.push({ key: entry.key, ...inferLegacyType(entry.value) });
		}
	}
	const bodyTemplate = body.replace(/^\n+/, "").replace(/\s+$/, "") || DEFAULT_BODY_TEMPLATE;
	return { properties, bodyTemplate };
}

function inferLegacyType(value: string | string[] | null): { type: PropertyType; value: string } {
	if (Array.isArray(value)) return { type: "list", value: value.join(", ") };
	if (value === null) return { type: "text", value: "" };
	if (/^(?:true|false)$/i.test(value)) return { type: "checkbox", value: value.toLowerCase() };
	if (/^[-+]?\d+(?:\.\d+)?$/.test(value)) return { type: "number", value };
	if (/^\d{4}-\d{2}-\d{2}/.test(value) || /\{\{\s*(?:date|modified|now)\b/.test(value)) return { type: "date", value };
	return { type: "text", value };
}

export function normalizeRoute(raw: unknown): Route {
	const r = (raw && typeof raw === "object" ? raw : {}) as Partial<Route> & { noteTemplate?: unknown };
	const route = newRoute();
	if (typeof r.id === "string" && r.id) route.id = r.id;
	if (typeof r.name === "string") route.name = r.name;
	route.enabled = r.enabled === true;
	if (typeof r.sourcePath === "string") route.sourcePath = r.sourcePath;
	if (typeof r.destination === "string") route.destination = r.destination;
	if (r.adapter === "generic") route.adapter = "generic";
	if (typeof r.filenameTemplate === "string" && r.filenameTemplate.trim()) route.filenameTemplate = r.filenameTemplate;
	if (POLICIES.includes(r.updatePolicy as UpdatePolicy)) route.updatePolicy = r.updatePolicy as UpdatePolicy;
	if (typeof r.stripTitleLine === "boolean") route.stripTitleLine = r.stripTitleLine;
	route.ai = normalizeAi(r.ai);
	const properties = normalizeProperties(r.properties);
	if (properties) {
		route.properties = properties;
		route.bodyTemplate = typeof r.bodyTemplate === "string" ? r.bodyTemplate : DEFAULT_BODY_TEMPLATE;
	} else if (typeof r.noteTemplate === "string") {
		const migrated = migrateLegacyTemplate(r.noteTemplate);
		route.properties = migrated.properties;
		route.bodyTemplate = migrated.bodyTemplate;
	} else if (typeof r.bodyTemplate === "string") {
		route.bodyTemplate = r.bodyTemplate;
	}
	return route;
}

/** Merge whatever was persisted with the defaults, filling in fields added by later versions. */
export function normalizeSettings(raw: unknown): FreewriterSettings {
	const src = (raw && typeof raw === "object" ? raw : {}) as Partial<FreewriterSettings>;
	const settings: FreewriterSettings = { ...DEFAULT_SETTINGS, ...src, routes: [], settingsVersion: DEFAULT_SETTINGS.settingsVersion };
	const routes = Array.isArray(src.routes) ? src.routes : [];
	settings.routes = routes.map((r) => normalizeRoute(r));
	if (typeof settings.identityProperty !== "string" || !settings.identityProperty.trim()) {
		settings.identityProperty = DEFAULT_SETTINGS.identityProperty;
	}
	if (typeof settings.statusProperty !== "string" || !settings.statusProperty.trim()) {
		settings.statusProperty = DEFAULT_SETTINGS.statusProperty;
	}
	if (!(Number(settings.checkIntervalMinutes) >= 1)) settings.checkIntervalMinutes = DEFAULT_SETTINGS.checkIntervalMinutes;
	if (!(Number(settings.debounceSeconds) >= 0.5)) settings.debounceSeconds = DEFAULT_SETTINGS.debounceSeconds;
	if (typeof settings.conflictSuffixTemplate !== "string") settings.conflictSuffixTemplate = DEFAULT_SETTINGS.conflictSuffixTemplate;
	if (typeof settings.openRouterApiKey !== "string") settings.openRouterApiKey = "";
	if (typeof settings.openRouterModel !== "string" || !settings.openRouterModel.trim()) settings.openRouterModel = DEFAULT_MODEL;
	return settings;
}
