import { describe, expect, it } from "vitest";
import { countWords, ensureContentPlaceholder, formatDateBasic, renderTemplate, type TemplateContext } from "../src/template";

const ctx: TemplateContext = {
	title: "Time",
	content: "Body with {{title}} inside.\n",
	date: new Date(2026, 4, 7, 6, 51, 9),
	modified: new Date(2026, 7, 6, 19, 1, 0),
	now: new Date(2026, 8, 5, 10, 0, 0),
	folder: "A",
	route: "Freewrite A",
	filename: "2026-05-07 Time",
	source: "A/2026-05-07 Time.md",
	words: 4,
};

describe("renderTemplate", () => {
	it("renders every variable with sensible defaults", () => {
		const out = renderTemplate(
			"{{title}}|{{date}}|{{modified}}|{{now}}|{{folder}}|{{route}}|{{filename}}|{{source}}|{{words}}",
			ctx,
		);
		expect(out).toBe("Time|2026-05-07|2026-08-06 19:01|2026-09-05 10:00|A|Freewrite A|2026-05-07 Time|A/2026-05-07 Time.md|4");
	});

	it("accepts custom date formats", () => {
		expect(renderTemplate("MP {{date:M-D-YYYY}}", ctx)).toBe("MP 5-7-2026");
		expect(renderTemplate("{{modified:YYYY-MM-DD HH-mm}}", ctx)).toBe("2026-08-06 19-01");
		expect(renderTemplate("{{ date : dddd, MMMM D }}", ctx)).toBe("Thursday, May 7");
	});

	it("does not expand placeholders inside inserted content", () => {
		expect(renderTemplate("{{content}}", ctx)).toBe("Body with {{title}} inside.\n");
	});

	it("leaves unknown variables untouched", () => {
		expect(renderTemplate("{{nope}} {{title}}", ctx)).toBe("{{nope}} Time");
	});

	it("uses the injected formatter", () => {
		expect(renderTemplate("{{date:X}}", ctx, (d, f) => `${f}:${d.getFullYear()}`)).toBe("X:2026");
	});
});

describe("ensureContentPlaceholder", () => {
	it("appends {{content}} when missing", () => {
		expect(ensureContentPlaceholder("---\na: 1\n---\n")).toBe("---\na: 1\n---\n\n{{content}}\n");
	});
	it("leaves templates that have it alone", () => {
		const t = "---\na: 1\n---\n{{ content }}\n";
		expect(ensureContentPlaceholder(t)).toBe(t);
	});
});

describe("formatDateBasic", () => {
	const d = new Date(2026, 0, 5, 14, 3, 7);
	it("handles the common tokens", () => {
		expect(formatDateBasic(d, "YYYY-MM-DD HH:mm:ss")).toBe("2026-01-05 14:03:07");
		expect(formatDateBasic(d, "M/D/YY h:mm a")).toBe("1/5/26 2:03 pm");
		expect(formatDateBasic(d, "ddd MMM D")).toBe("Mon Jan 5");
	});
	it("keeps bracketed literals", () => {
		expect(formatDateBasic(d, "[MP] M-D-YYYY")).toBe("MP 1-5-2026");
	});
});

describe("countWords", () => {
	it("counts whitespace-separated words", () => {
		expect(countWords("  one two\nthree  ")).toBe(3);
		expect(countWords("")).toBe(0);
	});
});
