import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS, normalizeSettings } from "../src/settings";
import { normalizeState } from "../src/state";

describe("normalizeSettings", () => {
	it("returns defaults for nothing", () => {
		expect(normalizeSettings(null)).toEqual({ ...DEFAULT_SETTINGS, routes: [] });
	});
	it("fills in missing route fields and rejects bad numbers", () => {
		const s = normalizeSettings({ routes: [{ id: "abc", name: "A", sourcePath: "/x" }], checkIntervalMinutes: 0, identityProperty: " " });
		expect(s.routes[0].id).toBe("abc");
		expect(s.routes[0].updatePolicy).toBe("sync");
		expect(s.routes[0].noteTemplate.includes("{{content}}")).toBe(true);
		expect(s.checkIntervalMinutes).toBe(10);
		expect(s.identityProperty).toBe("bridge_source");
	});
});

describe("normalizeState", () => {
	it("tolerates garbage", () => {
		expect(normalizeState("nope").records).toEqual({});
		expect(normalizeState({ records: { a: { sourceKey: "x" } } }).records.a.sourceKey).toBe("x");
	});
});
