import type { PropertyType } from "./settings";

export interface RenderedProperty {
	key: string;
	type: PropertyType;
	/** Rendered value; for lists, items separated by commas or newlines. */
	value: string;
}

const RESERVED = /^(?:true|false|yes|no|on|off|null|~)$/i;
const NUMERIC = /^[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?$/;
const DATE = /^\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2}(?::\d{2})?)?$/;
const SAFE_KEY = /^[A-Za-z0-9_][A-Za-z0-9_.-]*$/;
const NEEDS_QUOTES = /[:#{}[\],&*!|>'"%@`\\]|^[-?\s]|\s$|\n/;

export function quoteYaml(s: string): string {
	return `"${s.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n")}"`;
}

/** A string scalar that YAML will read back as exactly this string. */
export function yamlString(s: string): string {
	if (s === "") return '""';
	return RESERVED.test(s) || NUMERIC.test(s) || DATE.test(s) || NEEDS_QUOTES.test(s) ? quoteYaml(s) : s;
}

export function yamlScalar(value: string, type: PropertyType): string {
	const v = value.trim();
	switch (type) {
		case "checkbox":
			return isTruthy(v) ? "true" : "false";
		case "number":
			return NUMERIC.test(v) ? v : yamlString(v);
		case "date":
			return DATE.test(v) ? v : yamlString(v);
		default:
			return yamlString(v);
	}
}

export function isTruthy(value: string): boolean {
	return /^(?:true|yes|on|1)$/i.test(value.trim());
}

export function splitListValue(value: string): string[] {
	return value
		.split(/[,\n]/)
		.map((s) => s.trim())
		.filter(Boolean);
}

/** Build a complete front matter block (with fences) from rendered properties, or "" when there are none. */
export function buildFrontMatterYaml(props: RenderedProperty[]): string {
	const lines: string[] = [];
	for (const p of props) {
		const key = p.key.trim();
		if (!key) continue;
		const k = SAFE_KEY.test(key) ? key : quoteYaml(key);
		if (p.type === "list") {
			const items = splitListValue(p.value);
			if (!items.length) {
				lines.push(`${k}: []`);
			} else {
				lines.push(`${k}:`);
				for (const item of items) lines.push(`  - ${yamlString(item)}`);
			}
		} else {
			lines.push(`${k}: ${yamlScalar(p.value, p.type)}`);
		}
	}
	return lines.length ? `---\n${lines.join("\n")}\n---\n` : "";
}

export interface SimpleYamlEntry {
	key: string;
	value: string | string[] | null;
}

function unquote(s: string): string {
	if (s.length >= 2 && ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'")))) {
		return s.slice(1, -1).replace(/\\"/g, '"').replace(/\\\\/g, "\\");
	}
	return s;
}

/**
 * Reads the small YAML subset the plugin's own templates use: `key: value`,
 * `key: [a, b]`, `key:` followed by `- item` lines, and empty values.
 * Only used to migrate templates written before the properties editor existed.
 */
export function parseSimpleYaml(yaml: string): SimpleYamlEntry[] {
	const entries: SimpleYamlEntry[] = [];
	const lines = yaml.split("\n");
	let i = 0;
	while (i < lines.length) {
		const line = lines[i];
		if (!line.trim() || line.trim().startsWith("#")) {
			i++;
			continue;
		}
		const m = /^([^\s:][^:]*?):(?:\s+(.*))?$/.exec(line);
		if (!m) {
			i++;
			continue;
		}
		const key = unquote(m[1].trim());
		const rest = (m[2] ?? "").trim();
		if (rest === "") {
			const items: string[] = [];
			let j = i + 1;
			while (j < lines.length && /^\s+-\s*/.test(lines[j])) {
				items.push(unquote(lines[j].replace(/^\s+-\s*/, "").trim()));
				j++;
			}
			if (items.length) {
				entries.push({ key, value: items });
				i = j;
				continue;
			}
			entries.push({ key, value: null });
			i++;
			continue;
		}
		if (/^\[.*\]$/.test(rest)) {
			const inner = rest.slice(1, -1).trim();
			entries.push({ key, value: inner ? inner.split(",").map((s) => unquote(s.trim())) : [] });
			i++;
			continue;
		}
		entries.push({ key, value: unquote(rest) });
		i++;
	}
	return entries;
}
