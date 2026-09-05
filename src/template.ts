export interface TemplateContext {
	title: string;
	content: string;
	/** Date the draft was started (from the Postbox file name, else file birth time). */
	date: Date;
	/** Last modification time of the source file. */
	modified: Date;
	now: Date;
	/** Name of the source folder, e.g. "A". */
	folder: string;
	route: string;
	/** Source file name without extension. */
	filename: string;
	/** Identity key, e.g. "A/2026-05-07 Time.md". */
	source: string;
	words: number;
}

export type DateFormatter = (date: Date, format: string) => string;

const DEFAULT_DATE_FORMAT = "YYYY-MM-DD";
const DEFAULT_DATETIME_FORMAT = "YYYY-MM-DD HH:mm";
const CONTENT_PLACEHOLDER = /\{\{\s*content\s*\}\}/;

const PLACEHOLDER = /\{\{\s*([a-zA-Z_]+)\s*(?::\s*([^}]+?))?\s*\}\}/g;

/**
 * Replace {{variables}} in one pass. Values are never re-scanned, so a draft that
 * happens to contain "{{title}}" comes through untouched. Unknown variables are left as-is.
 */
export function renderTemplate(template: string, ctx: TemplateContext, formatDate: DateFormatter = formatDateBasic): string {
	return template.replace(PLACEHOLDER, (match: string, name: string, fmt?: string) => {
		switch (name) {
			case "title":
				return ctx.title;
			case "content":
				return ctx.content;
			case "date":
				return formatDate(ctx.date, fmt ?? DEFAULT_DATE_FORMAT);
			case "modified":
				return formatDate(ctx.modified, fmt ?? DEFAULT_DATETIME_FORMAT);
			case "now":
				return formatDate(ctx.now, fmt ?? DEFAULT_DATETIME_FORMAT);
			case "folder":
				return ctx.folder;
			case "route":
				return ctx.route;
			case "filename":
				return ctx.filename;
			case "source":
				return ctx.source;
			case "words":
				return String(ctx.words);
			default:
				return match;
		}
	});
}

/** A note template without {{content}} gets the draft appended at the end. */
export function ensureContentPlaceholder(template: string): string {
	if (CONTENT_PLACEHOLDER.test(template)) return template;
	return template.replace(/\s+$/, "") + "\n\n{{content}}\n";
}

export function countWords(text: string): number {
	const trimmed = text.trim();
	return trimmed ? trimmed.split(/\s+/).length : 0;
}

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const TOKEN = /\[[^\]]*\]|YYYY|YY|MMMM|MMM|MM|M|DD|D|dddd|ddd|HH|H|hh|h|mm|m|ss|A|a/g;

const pad = (n: number, width = 2): string => String(n).padStart(width, "0");

/**
 * A small moment-compatible formatter for the common tokens. Inside Obsidian the plugin
 * passes moment itself, so every moment format works there; this keeps the pure code testable.
 */
export function formatDateBasic(d: Date, format: string): string {
	return format.replace(TOKEN, (token: string) => {
		if (token.startsWith("[")) return token.slice(1, -1);
		switch (token) {
			case "YYYY":
				return String(d.getFullYear());
			case "YY":
				return pad(d.getFullYear() % 100);
			case "MMMM":
				return MONTHS[d.getMonth()];
			case "MMM":
				return MONTHS[d.getMonth()].slice(0, 3);
			case "MM":
				return pad(d.getMonth() + 1);
			case "M":
				return String(d.getMonth() + 1);
			case "DD":
				return pad(d.getDate());
			case "D":
				return String(d.getDate());
			case "dddd":
				return DAYS[d.getDay()];
			case "ddd":
				return DAYS[d.getDay()].slice(0, 3);
			case "HH":
				return pad(d.getHours());
			case "H":
				return String(d.getHours());
			case "hh":
				return pad(d.getHours() % 12 || 12);
			case "h":
				return String(d.getHours() % 12 || 12);
			case "mm":
				return pad(d.getMinutes());
			case "m":
				return String(d.getMinutes());
			case "ss":
				return pad(d.getSeconds());
			case "A":
				return d.getHours() < 12 ? "AM" : "PM";
			case "a":
				return d.getHours() < 12 ? "am" : "pm";
			default:
				return token;
		}
	});
}
