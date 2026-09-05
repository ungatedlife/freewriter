import { describe, expect, it } from "vitest";
import { scanRoute } from "../src/sync/scanner";
import type { SyncState } from "../src/state";
import type { SourceEntry } from "../src/sync/source";

const entry = (name: string, size = 10, mtimeMs = 1000): SourceEntry => ({
	path: `/pb/A/${name}`,
	name,
	size,
	mtimeMs,
	birthtimeMs: 500,
});

const record = (name: string, size = 10, mtimeMs = 1000, status: "synced" | "missing" = "synced") => ({
	routeId: "r1",
	sourceKey: `A/${name}`,
	sourcePath: `/pb/A/${name}`,
	size,
	mtimeMs,
	contentHash: "h",
	notePath: `Freewrite/${name}`,
	bodyHash: "b",
	lastSyncedAt: 0,
	status,
});

describe("scanRoute", () => {
	it("classifies new, changed, unchanged and missing files", () => {
		const state: SyncState = {
			version: 1,
			records: {
				"/pb/A/same.md": record("same.md"),
				"/pb/A/changed.md": record("changed.md", 10, 999),
				"/pb/A/gone.md": record("gone.md"),
				"/pb/A/other-route.md": { ...record("other-route.md"), routeId: "r2" },
			},
		};
		const r = scanRoute("r1", [entry("same.md"), entry("changed.md"), entry("new.md"), entry("other-route.md")], state);
		expect(r.unchanged.map((e) => e.name)).toEqual(["same.md"]);
		expect(r.candidates.map((e) => e.name).sort()).toEqual(["changed.md", "new.md", "other-route.md"]);
		expect(r.missing.map((m) => m.sourceKey)).toEqual(["A/gone.md"]);
	});

	it("re-checks a file whose record says missing when it reappears", () => {
		const state: SyncState = { version: 1, records: { "/pb/A/back.md": record("back.md", 10, 1000, "missing") } };
		const r = scanRoute("r1", [entry("back.md")], state);
		expect(r.candidates).toHaveLength(1);
	});

	it("does not report ignored files as missing when told about all paths", () => {
		const state: SyncState = { version: 1, records: { "/pb/A/old.md": record("old.md") } };
		const r = scanRoute("r1", [], state, new Set(["/pb/A/old.md"]));
		expect(r.missing).toHaveLength(0);
	});

	it("does not report already-missing records again", () => {
		const state: SyncState = { version: 1, records: { "/pb/A/gone.md": record("gone.md", 10, 1000, "missing") } };
		expect(scanRoute("r1", [], state).missing).toHaveLength(0);
	});
});
