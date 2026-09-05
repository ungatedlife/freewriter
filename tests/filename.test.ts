import { describe, expect, it } from "vitest";
import { joinVaultPath, parentFolder, sanitizeFilename, uniqueName } from "../src/filename";

describe("sanitizeFilename", () => {
	it("removes characters Obsidian rejects", () => {
		expect(sanitizeFilename('Who: what? "why" <a|b> [c] #d ^e /f \\g *h')).toBe("Who what why a b c d e f g h");
	});
	it("collapses whitespace and trims trailing dots", () => {
		expect(sanitizeFilename("  Hello   world... ")).toBe("Hello world");
	});
	it("falls back when nothing is left", () => {
		expect(sanitizeFilename("???")).toBe("Untitled");
		expect(sanitizeFilename("", "Draft")).toBe("Draft");
	});
	it("caps very long names", () => {
		expect(sanitizeFilename("x".repeat(400)).length).toBe(180);
	});
});

describe("uniqueName", () => {
	it("returns the base when free", () => {
		expect(uniqueName("Time", () => false)).toBe("Time");
	});
	it("appends a counter when taken", () => {
		const taken = new Set(["Time", "Time (2)"]);
		expect(uniqueName("Time", (c) => taken.has(c))).toBe("Time (3)");
	});
});

describe("vault paths", () => {
	it("joins with the root handled", () => {
		expect(joinVaultPath("", "a.md")).toBe("a.md");
		expect(joinVaultPath("/", "a.md")).toBe("a.md");
		expect(joinVaultPath("Freewrite/A/", "a.md")).toBe("Freewrite/A/a.md");
	});
	it("finds the parent folder", () => {
		expect(parentFolder("Freewrite/A/a.md")).toBe("Freewrite/A");
		expect(parentFolder("a.md")).toBe("");
	});
});
