import type { ParsedDraft, ParseOptions, SourceAdapter, SourceStats } from "./types";
import { normalizeText } from "./postbox";

const EXT = /\.(md|txt)$/i;

/** Any folder of .md or .txt files: the file name is the title, the birth time is the date. */
export const genericAdapter: SourceAdapter = {
	id: "generic",
	label: "Generic files",
	matches(filename: string): boolean {
		return EXT.test(filename);
	},
	parse(filename: string, raw: string, stats: SourceStats, _opts: ParseOptions): ParsedDraft {
		const fullText = normalizeText(raw);
		const title = filename.replace(EXT, "").replace(/\s+/g, " ").trim() || "Untitled";
		return {
			title,
			date: new Date(stats.birthtimeMs || stats.mtimeMs),
			content: fullText.replace(/^\n+/, "").replace(/\s+$/, ""),
			fullText,
			titleLine: null,
			hasDateInName: false,
		};
	},
};
