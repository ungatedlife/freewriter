export type UpdatePolicy = "sync" | "overwrite" | "once";
export type AdapterId = "postbox" | "generic";

export interface Route {
	id: string;
	name: string;
	enabled: boolean;
	/** Absolute path of the folder on disk that Postbox syncs to. */
	sourcePath: string;
	/** Vault folder the notes are written to ("" or "/" means the vault root). */
	destination: string;
	adapter: AdapterId;
	filenameTemplate: string;
	noteTemplate: string;
	updatePolicy: UpdatePolicy;
	stripTitleLine: boolean;
}

export interface BridgeSettings {
	settingsVersion: number;
	routes: Route[];
	identityProperty: string;
	statusProperty: string;
	checkIntervalMinutes: number;
	debounceSeconds: number;
	markMissingSources: boolean;
	conflictSuffixTemplate: string;
	syncOnStartup: boolean;
}

export const DEFAULT_NOTE_TEMPLATE = [
	"---",
	"date: {{date}}",
	"tags:",
	"  - freewrite",
	"---",
	"{{content}}",
	"",
].join("\n");

export const DEFAULT_SETTINGS: BridgeSettings = {
	settingsVersion: 1,
	routes: [],
	identityProperty: "bridge_source",
	statusProperty: "bridge_status",
	checkIntervalMinutes: 10,
	debounceSeconds: 2,
	markMissingSources: true,
	conflictSuffixTemplate: "(updated {{modified:YYYY-MM-DD HH-mm}})",
	syncOnStartup: true,
};

export const UPDATE_POLICY_LABELS: Record<UpdatePolicy, string> = {
	sync: "Keep in sync until I edit it here",
	overwrite: "Always overwrite the body",
	once: "Import once, never update",
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
		noteTemplate: DEFAULT_NOTE_TEMPLATE,
		updatePolicy: "sync",
		stripTitleLine: true,
		...partial,
	};
}

/** Merge whatever was persisted with the defaults, filling in fields added by later versions. */
export function normalizeSettings(raw: unknown): BridgeSettings {
	const src = (raw && typeof raw === "object" ? raw : {}) as Partial<BridgeSettings>;
	const settings: BridgeSettings = { ...DEFAULT_SETTINGS, ...src, routes: [] };
	const routes = Array.isArray(src.routes) ? src.routes : [];
	settings.routes = routes.map((r) => newRoute(r as Partial<Route>));
	if (typeof settings.identityProperty !== "string" || !settings.identityProperty.trim()) {
		settings.identityProperty = DEFAULT_SETTINGS.identityProperty;
	}
	if (typeof settings.statusProperty !== "string" || !settings.statusProperty.trim()) {
		settings.statusProperty = DEFAULT_SETTINGS.statusProperty;
	}
	if (!(Number(settings.checkIntervalMinutes) >= 1)) settings.checkIntervalMinutes = DEFAULT_SETTINGS.checkIntervalMinutes;
	if (!(Number(settings.debounceSeconds) >= 0.5)) settings.debounceSeconds = DEFAULT_SETTINGS.debounceSeconds;
	if (typeof settings.conflictSuffixTemplate !== "string") settings.conflictSuffixTemplate = DEFAULT_SETTINGS.conflictSuffixTemplate;
	return settings;
}
