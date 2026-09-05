import { describe, expect, it } from "vitest";
import { buildFrontMatterYaml, parseSimpleYaml, splitListValue, yamlScalar, yamlString } from "../src/yaml";

describe("yamlString", () => {
	it("leaves plain words alone", () => {
		expect(yamlString("writing")).toBe("writing");
		expect(yamlString("Morning pages")).toBe("Morning pages");
	});
	it("quotes anything YAML would read as something else", () => {
		expect(yamlString("true")).toBe('"true"');
		expect(yamlString("42")).toBe('"42"');
		expect(yamlString("2026-05-07")).toBe('"2026-05-07"');
		expect(yamlString("[[Dialogic Studio]]")).toBe('"[[Dialogic Studio]]"');
		expect(yamlString("a: b")).toBe('"a: b"');
		expect(yamlString("#tag")).toBe('"#tag"');
		expect(yamlString("- dash")).toBe('"- dash"');
		expect(yamlString("")).toBe('""');
	});
	it("escapes quotes and backslashes", () => {
		expect(yamlString('say "hi" \\ there')).toBe('"say \\"hi\\" \\\\ there"');
	});
});

describe("yamlScalar", () => {
	it("keeps dates and numbers bare for their types", () => {
		expect(yamlScalar("2026-05-07", "date")).toBe("2026-05-07");
		expect(yamlScalar("2026-05-07T06:51", "date")).toBe("2026-05-07T06:51");
		expect(yamlScalar("not a date", "date")).toBe("not a date");
		expect(yamlScalar("3.5", "number")).toBe("3.5");
		expect(yamlScalar("three", "number")).toBe("three");
		expect(yamlScalar("yes", "checkbox")).toBe("true");
		expect(yamlScalar("", "checkbox")).toBe("false");
	});
});

describe("buildFrontMatterYaml", () => {
	it("writes a complete block", () => {
		const yaml = buildFrontMatterYaml([
			{ key: "type", type: "text", value: "writing" },
			{ key: "status", type: "text", value: "draft" },
			{ key: "description", type: "text", value: "" },
			{ key: "date", type: "date", value: "2026-05-07" },
			{ key: "topics", type: "list", value: "" },
			{ key: "tags", type: "list", value: "freewriting, morning-pages" },
			{ key: "project", type: "text", value: "[[Dialogic Studio]]" },
			{ key: "members", type: "checkbox", value: "true" },
			{ key: "words", type: "number", value: "812" },
		]);
		expect(yaml).toBe(
			[
				"---",
				"type: writing",
				"status: draft",
				'description: ""',
				"date: 2026-05-07",
				"topics: []",
				"tags:",
				"  - freewriting",
				"  - morning-pages",
				'project: "[[Dialogic Studio]]"',
				"members: true",
				"words: 812",
				"---",
				"",
			].join("\n"),
		);
	});
	it("skips properties without a key and returns nothing for an empty list", () => {
		expect(buildFrontMatterYaml([{ key: " ", type: "text", value: "x" }])).toBe("");
		expect(buildFrontMatterYaml([])).toBe("");
	});
	it("quotes unusual keys", () => {
		expect(buildFrontMatterYaml([{ key: "my key", type: "text", value: "v" }])).toBe('---\n"my key": v\n---\n');
	});
});

describe("splitListValue", () => {
	it("splits on commas and newlines and drops blanks", () => {
		expect(splitListValue(" a, b ,,\nc ")).toEqual(["a", "b", "c"]);
	});
});

describe("parseSimpleYaml", () => {
	it("reads scalars, block lists, flow lists and empty values", () => {
		const entries = parseSimpleYaml('type: writing\ndescription: \ndate: {{date}}\ntopics: []\ntags:\n  - freewriting\n  - "morning pages"\nproject: "[[Dialogic Studio]]"');
		expect(entries).toEqual([
			{ key: "type", value: "writing" },
			{ key: "description", value: null },
			{ key: "date", value: "{{date}}" },
			{ key: "topics", value: [] },
			{ key: "tags", value: ["freewriting", "morning pages"] },
			{ key: "project", value: "[[Dialogic Studio]]" },
		]);
	});
});
