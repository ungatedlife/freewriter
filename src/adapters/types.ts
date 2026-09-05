import type { AdapterId } from "../settings";

export interface SourceStats {
	size: number;
	mtimeMs: number;
	birthtimeMs: number;
}

export interface ParsedDraft {
	/** Best available title, at most 80 characters. */
	title: string;
	/** When the draft was started. */
	date: Date;
	/** Normalized text for the note body (LF line endings, optional title line removed). */
	content: string;
	/** Normalized full text, used for change detection. */
	fullText: string;
	/** The first line when it looks like a deliberate title, else null. */
	titleLine: string | null;
	hasDateInName: boolean;
}

export interface ParseOptions {
	stripTitleLine: boolean;
}

export interface SourceAdapter {
	id: AdapterId;
	label: string;
	matches(filename: string): boolean;
	parse(filename: string, raw: string, stats: SourceStats, opts: ParseOptions): ParsedDraft;
}
