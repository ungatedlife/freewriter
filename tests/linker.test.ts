import { describe, expect, it } from "vitest";
import { decideUpdate } from "../src/sync/linker";

describe("decideUpdate", () => {
	it("creates when there is no note", () => {
		expect(decideUpdate("sync", false, null, null)).toBe("create");
	});
	it("overwrites an untouched note under the sync policy", () => {
		expect(decideUpdate("sync", true, "abc", "abc")).toBe("overwrite");
	});
	it("flags a conflict when the body was edited in Obsidian", () => {
		expect(decideUpdate("sync", true, "edited", "abc")).toBe("conflict");
	});
	it("plays safe without a baseline", () => {
		expect(decideUpdate("sync", true, "abc", null)).toBe("conflict");
	});
	it("always overwrites under the overwrite policy", () => {
		expect(decideUpdate("overwrite", true, "edited", "abc")).toBe("overwrite");
	});
	it("skips under the once policy", () => {
		expect(decideUpdate("once", true, "abc", "abc")).toBe("skip-once");
	});
});

import { cleanTitle } from "../src/sync/engine";

describe("cleanTitle", () => {
	it("takes the first line and strips decoration", () => {
		expect(cleanTitle('\n"On Time."\n\nSecond line')).toBe("On Time");
		expect(cleanTitle("# Scars")).toBe("Scars");
		expect(cleanTitle("Title: Morning pages")).toBe("Morning pages");
		expect(cleanTitle("   ")).toBe("");
	});
	it("cuts very long titles at a word boundary", () => {
		const long = Array(30).fill("word").join(" ");
		expect(cleanTitle(long).length).toBeLessThanOrEqual(80);
	});
});
