import type { SourceRecord, SyncState } from "../state";
import type { SourceEntry } from "./source";

export interface ScanResult {
	/** Files that are new, changed on disk, or whose record needs attention. */
	candidates: SourceEntry[];
	/** Files whose size and mtime match the last sync. */
	unchanged: SourceEntry[];
	/** Records for this route whose source file is no longer in the folder. */
	missing: SourceRecord[];
}

/** Pure diff of what is on disk against what the state remembers. No file contents are read here. */
export function scanRoute(routeId: string, entries: SourceEntry[], state: SyncState): ScanResult {
	const candidates: SourceEntry[] = [];
	const unchanged: SourceEntry[] = [];
	const seen = new Set<string>();
	for (const entry of entries) {
		seen.add(entry.path);
		const rec = state.records[entry.path];
		const stale =
			!rec ||
			rec.routeId !== routeId ||
			rec.size !== entry.size ||
			rec.mtimeMs !== entry.mtimeMs ||
			rec.status === "missing";
		if (stale) candidates.push(entry);
		else unchanged.push(entry);
	}
	const missing = Object.values(state.records).filter(
		(r) => r.routeId === routeId && !seen.has(r.sourcePath) && r.status !== "missing",
	);
	return { candidates, unchanged, missing };
}
