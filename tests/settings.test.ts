import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS, migrateLegacyTemplate, normalizeSettings } from "../src/settings";
import { normalizeState } from "../src/state";

describe("normalizeSettings", () => {
	it("returns defaults for nothing", () => {
		expect(normalizeSettings(null)).toEqual({ ...DEFAULT_SETTINGS, routes: [] });
	});

	it("fills in missing route fields and rejects bad numbers", () => {
		const s = normalizeSettings({ routes: [{ id: "abc", name: "A", sourcePath: "/x" }], checkIntervalMinutes: 0, identityProperty: " " });
		expect(s.routes[0].id).toBe("abc");
		expect(s.routes[0].updatePolicy).toBe("sync");
		expect(s.routes[0].properties.map((p) => p.key)).toEqual(["date", "tags"]);
		expect(s.routes[0].bodyTemplate).toBe("{{content}}");
		expect(s.routes[0].ai.enabled).toBe(false);
		expect(s.checkIntervalMinutes).toBe(10);
		expect(s.identityProperty).toBe("freewriter_source");
		expect(s.openRouterModel).toBe(DEFAULT_SETTINGS.openRouterModel);
	});

	it("drops malformed properties and unknown types", () => {
		const s = normalizeSettings({ routes: [{ properties: [{ key: "type", type: "bogus", value: 3 }, "nope", { value: "x" }] }] });
		expect(s.routes[0].properties).toEqual([{ key: "type", type: "text", value: "" }]);
	});

	it("migrates a legacy text template into properties and a body", () => {
		const legacy = "---\ntype: writing\nstatus: draft\ndescription: \ndate: {{date}}\ntopics: []\n---\n## morning pages\n\n{{content}}\n";
		const s = normalizeSettings({ routes: [{ id: "a", noteTemplate: legacy }] });
		expect(s.routes[0].properties).toEqual([
			{ key: "type", type: "text", value: "writing" },
			{ key: "status", type: "text", value: "draft" },
			{ key: "description", type: "text", value: "" },
			{ key: "date", type: "date", value: "{{date}}" },
			{ key: "topics", type: "list", value: "" },
		]);
		expect(s.routes[0].bodyTemplate).toBe("## morning pages\n\n{{content}}");
	});
});

describe("migrateLegacyTemplate", () => {
	it("handles a template without front matter", () => {
		expect(migrateLegacyTemplate("{{content}}\n")).toEqual({ properties: [], bodyTemplate: "{{content}}" });
	});
	it("infers list, checkbox and number types", () => {
		const { properties } = migrateLegacyTemplate("---\ntags:\n  - a\n  - b\ndone: false\nrank: 3\n---\n");
		expect(properties).toEqual([
			{ key: "tags", type: "list", value: "a, b" },
			{ key: "done", type: "checkbox", value: "false" },
			{ key: "rank", type: "number", value: "3" },
		]);
	});
});

describe("normalizeState", () => {
	it("tolerates garbage", () => {
		expect(normalizeState("nope").records).toEqual({});
		expect(normalizeState({ records: { a: { sourceKey: "x" } } }).records.a.sourceKey).toBe("x");
	});
});
