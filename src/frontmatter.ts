export interface SplitNote {
	/** The full front matter block including both fences and the trailing newline, or null. */
	frontmatter: string | null;
	body: string;
}

const FRONT_MATTER = /^---[ \t]*\r?\n(?:[\s\S]*?\r?\n)?(?:---|\.\.\.)[ \t]*(?:\r?\n|$)/;

/** Split a note into its front matter block and everything after it. */
export function splitFrontMatter(text: string): SplitNote {
	const m = FRONT_MATTER.exec(text);
	if (!m) return { frontmatter: null, body: text };
	return { frontmatter: m[0], body: text.slice(m[0].length) };
}

/** The YAML between the fences, without the fences. */
export function frontMatterYaml(block: string): string {
	return block
		.replace(/^---[ \t]*\r?\n/, "")
		.replace(/\r?\n?(?:---|\.\.\.)[ \t]*(?:\r?\n)?$/, "");
}
