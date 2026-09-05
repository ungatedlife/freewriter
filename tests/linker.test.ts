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
