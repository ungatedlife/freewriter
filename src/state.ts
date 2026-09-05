export type RecordStatus = "synced" | "conflict" | "missing" | "detached";

export interface SourceRecord {
	routeId: string;
	/** Identity written to the note, e.g. "A/2026-05-07 Time.md". */
	sourceKey: string;
	/** Absolute path of the source file. */
	sourcePath: string;
	size: number;
	mtimeMs: number;
	/** sha256 of the normalized source text. */
	contentHash: string;
	/** Vault path of the linked note, or null when detached. */
	notePath: string | null;
	/** sha256 of the note body as Bridge last wrote it; used to detect edits made in Obsidian. */
	bodyHash: string | null;
	lastSyncedAt: number;
	status: RecordStatus;
}

export interface SyncState {
	version: 1;
	/** Keyed by absolute source path. */
	records: Record<string, SourceRecord>;
}

export function emptyState(): SyncState {
	return { version: 1, records: {} };
}

export function normalizeState(raw: unknown): SyncState {
	if (!raw || typeof raw !== "object") return emptyState();
	const r = raw as Partial<SyncState>;
	const records = r.records && typeof r.records === "object" ? (r.records as Record<string, SourceRecord>) : {};
	return { version: 1, records };
}
