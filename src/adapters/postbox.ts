import type { ParsedDraft, ParseOptions, SourceAdapter, SourceStats } from "./types";

export const TITLE_MAX = 80;

const EXT = /\.(md|txt)$/i;
const HEX_SUFFIX = /\s*-[0-9a-f]{8}-\s*$/i;
const DATE_PREFIX = /^(\d{4})-(\d{2}|[A-Za-z]{3})-(\d{2})(?:\s+|$)/;
const MONTHS: Record<string, number> = {
	jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11,
};

export function normalizeText(raw: string): string {
	return raw.replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n");
}

export interface PostboxName {
	date: Date | null;
	/** Title as it appears in the file name (punctuation already replaced by Postbox). */
	nameTitle: string;
	stem: string;
}

/**
 * Postbox names files "YYYY-MM-DD <first line>.md" (older exports used "YYYY-MMM-DD"),
 * and appends "-xxxxxxxx-" when two drafts share a title.
 */
export function parsePostboxName(filename: string): PostboxName {
	const stem = filename.replace(EXT, "");
	let rest = stem;
	let date: Date | null = null;
	const m = DATE_PREFIX.exec(stem);
	if (m) {
		const year = Number(m[1]);
		const month = /^\d+$/.test(m[2]) ? Number(m[2]) - 1 : MONTHS[m[2].toLowerCase()];
		const day = Number(m[3]);
		if (month !== undefined && month >= 0 && month < 12 && day >= 1 && day <= 31) {
			date = new Date(year, month, day);
			rest = stem.slice(m[0].length);
		}
	}
	const nameTitle = rest.replace(HEX_SUFFIX, "").trim();
	return { date, nameTitle, stem };
}

export function truncateWords(text: string, max: number): string {
	if (text.length <= max) return text;
	const cut = text.lastIndexOf(" ", max);
	return text.slice(0, cut >= max / 2 ? cut : max).trim();
}

export interface ExtractedTitle {
	title: string;
	titleLine: string | null;
	/** Index of the first non-empty line, or -1 for an empty draft. */
	firstLineIndex: number;
}

/**
 * The first non-empty line is the title when it is short (≤ 80 chars) and more text follows.
 * A long first line is an opening paragraph; a single-line draft has no separate title.
 */
export function extractTitle(text: string): ExtractedTitle {
	const lines = text.split("\n");
	const firstLineIndex = lines.findIndex((l) => l.trim().length > 0);
	if (firstLineIndex === -1) return { title: "", titleLine: null, firstLineIndex };
	const first = lines[firstLineIndex].trim().replace(/^#{1,6}\s+/, "").replace(/\s+/g, " ");
	const hasMore = lines.slice(firstLineIndex + 1).some((l) => l.trim().length > 0);
	const titleLike = first.length <= TITLE_MAX && hasMore;
	return { title: truncateWords(first, TITLE_MAX), titleLine: titleLike ? lines[firstLineIndex] : null, firstLineIndex };
}

function removeLine(text: string, index: number): string {
	const lines = text.split("\n");
	lines.splice(index, 1);
	return lines.join("\n");
}

/** Strip leading blank lines and trailing whitespace; the note template supplies the final newline. */
function tidyBody(text: string): string {
	return text.replace(/^\n+/, "").replace(/\s+$/, "");
}

export const postboxAdapter: SourceAdapter = {
	id: "postbox",
	label: "Freewrite Postbox",
	matches(filename: string): boolean {
		return EXT.test(filename);
	},
	parse(filename: string, raw: string, stats: SourceStats, opts: ParseOptions): ParsedDraft {
		const fullText = normalizeText(raw);
		const { date: nameDate, nameTitle } = parsePostboxName(filename);
		const extracted = extractTitle(fullText);
		const title = extracted.title || nameTitle || "Untitled";
		const date = nameDate ?? new Date(stats.birthtimeMs || stats.mtimeMs);
		let content = fullText;
		if (opts.stripTitleLine && extracted.titleLine !== null) {
			content = removeLine(fullText, extracted.firstLineIndex);
		}
		return {
			title,
			date,
			content: tidyBody(content),
			fullText,
			titleLine: extracted.titleLine,
			hasDateInName: nameDate !== null,
		};
	},
};
