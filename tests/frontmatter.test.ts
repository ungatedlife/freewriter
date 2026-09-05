import { describe, expect, it } from "vitest";
import { frontMatterYaml, splitFrontMatter } from "../src/frontmatter";

describe("splitFrontMatter", () => {
	it("splits a normal note", () => {
		const r = splitFrontMatter("---\ndate: 2026-05-07\n---\nBody\n");
		expect(r.frontmatter).toBe("---\ndate: 2026-05-07\n---\n");
		expect(r.body).toBe("Body\n");
	});
	it("handles empty front matter", () => {
		const r = splitFrontMatter("---\n---\nBody");
		expect(r.frontmatter).toBe("---\n---\n");
		expect(r.body).toBe("Body");
	});
	it("handles CRLF", () => {
		const r = splitFrontMatter("---\r\na: 1\r\n---\r\nBody");
		expect(r.body).toBe("Body");
	});
	it("returns the whole text as body when there is no front matter", () => {
		const r = splitFrontMatter("Just text\n---\nnot front matter\n");
		expect(r.frontmatter).toBeNull();
		expect(r.body).toBe("Just text\n---\nnot front matter\n");
	});
	it("does not mistake a horizontal rule for front matter", () => {
		const r = splitFrontMatter("---\nSome text without a closing fence");
		expect(r.frontmatter).toBeNull();
	});
	it("yields the yaml between the fences", () => {
		expect(frontMatterYaml("---\na: 1\nb: 2\n---\n")).toBe("a: 1\nb: 2");
	});
});
