import { describe, expect, it } from "vitest";
import { extractTitle, normalizeText, parsePostboxName, postboxAdapter, truncateWords } from "../src/adapters/postbox";

const stats = { size: 10, mtimeMs: 1_780_000_000_000, birthtimeMs: 1_770_000_000_000 };

describe("parsePostboxName", () => {
	it("reads the ISO date prefix and the title", () => {
		const r = parsePostboxName("2026-05-07 Time.md");
		expect(r.date?.getFullYear()).toBe(2026);
		expect(r.date?.getMonth()).toBe(4);
		expect(r.date?.getDate()).toBe(7);
		expect(r.nameTitle).toBe("Time");
	});

	it("drops the hex collision suffix", () => {
		expect(parsePostboxName("2026-03-14 Morning pages -53a9dfd4-.md").nameTitle).toBe("Morning pages");
	});

	it("understands the older month-abbreviation format and .txt", () => {
		const r = parsePostboxName("2022-May-27 Friday, May 27th, 20.txt");
		expect(r.date?.getFullYear()).toBe(2022);
		expect(r.date?.getMonth()).toBe(4);
		expect(r.date?.getDate()).toBe(27);
		expect(r.nameTitle).toBe("Friday, May 27th, 20");
	});

	it("returns no date when the name has no prefix", () => {
		const r = parsePostboxName("Notes.md");
		expect(r.date).toBeNull();
		expect(r.nameTitle).toBe("Notes");
	});

	it("keeps a leading number that is not a date", () => {
		const r = parsePostboxName("2026-13-45 Not a date.md");
		expect(r.date).toBeNull();
		expect(r.nameTitle).toBe("2026-13-45 Not a date");
	});
});

describe("extractTitle", () => {
	it("treats a short first line followed by more text as the title", () => {
		const r = extractTitle("Time\n\nOk, picking up here.\n");
		expect(r.title).toBe("Time");
		expect(r.titleLine).toBe("Time");
	});

	it("also accepts a title without a blank line after it", () => {
		const r = extractTitle("Tending the Ember\nThe ember is small.\n");
		expect(r.titleLine).toBe("Tending the Ember");
	});

	it("does not treat a long opening sentence as a title", () => {
		const long = "I'm feeling anxious this morning. Ugh. I don't want to do anything. I want to go back to bed and read.";
		const r = extractTitle(`${long}\n\nMore text.\n`);
		expect(r.titleLine).toBeNull();
		expect(r.title.length).toBeLessThanOrEqual(80);
		expect(r.title.startsWith("I'm feeling anxious")).toBe(true);
	});

	it("does not treat a single-line draft as a title", () => {
		const r = extractTitle("Just one line here.\n");
		expect(r.titleLine).toBeNull();
		expect(r.title).toBe("Just one line here.");
	});

	it("strips markdown heading markers from the title", () => {
		expect(extractTitle("# Scars\n\nBody.\n").title).toBe("Scars");
	});

	it("skips leading blank lines", () => {
		const r = extractTitle("\n\nTitle\n\nBody\n");
		expect(r.title).toBe("Title");
		expect(r.firstLineIndex).toBe(2);
	});
});

describe("truncateWords", () => {
	it("cuts at a word boundary", () => {
		expect(truncateWords("alpha beta gamma delta", 12)).toBe("alpha beta");
	});
	it("leaves short text alone", () => {
		expect(truncateWords("alpha", 12)).toBe("alpha");
	});
});

describe("postboxAdapter", () => {
	it("normalizes CRLF and BOM and strips the title line when asked", () => {
		const raw = "﻿Time\r\n\r\nOk, picking up here.\r\nMore.\r\n";
		const d = postboxAdapter.parse("2026-05-07 Time.md", raw, stats, { stripTitleLine: true });
		expect(d.title).toBe("Time");
		expect(d.content).toBe("Ok, picking up here.\nMore.");
		expect(d.fullText).toBe("Time\n\nOk, picking up here.\nMore.\n");
		expect(d.date.getDate()).toBe(7);
		expect(d.hasDateInName).toBe(true);
	});

	it("keeps the title line when stripping is off", () => {
		const d = postboxAdapter.parse("2026-05-07 Time.md", "Time\n\nBody.\n", stats, { stripTitleLine: false });
		expect(d.content).toBe("Time\n\nBody.");
	});

	it("never strips a long opening paragraph", () => {
		const long = "This is a long opening line that runs well past eighty characters because it is really a paragraph.";
		const d = postboxAdapter.parse("2026-01-27 x.md", `${long}\n\nSecond paragraph.\n`, stats, { stripTitleLine: true });
		expect(d.content.startsWith(long)).toBe(true);
	});

	it("falls back to the file birth time when the name has no date", () => {
		const d = postboxAdapter.parse("Notes.md", "Notes\n\nBody\n", stats, { stripTitleLine: true });
		expect(d.date.getTime()).toBe(stats.birthtimeMs);
		expect(d.hasDateInName).toBe(false);
	});

	it("uses the file name title when the draft is empty", () => {
		const d = postboxAdapter.parse("2026-05-01 Morning pages -812ed3fd-.md", "", stats, { stripTitleLine: true });
		expect(d.title).toBe("Morning pages");
		expect(d.content).toBe("");
	});

	it("matches .md and .txt only", () => {
		expect(postboxAdapter.matches("a.md")).toBe(true);
		expect(postboxAdapter.matches("a.TXT")).toBe(true);
		expect(postboxAdapter.matches("Icon\r")).toBe(false);
		expect(postboxAdapter.matches("a.docx")).toBe(false);
	});

	it("normalizeText handles lone CR", () => {
		expect(normalizeText("a\rb\r\nc")).toBe("a\nb\nc");
	});
});
