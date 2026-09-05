const pad = (n: number): string => String(n).padStart(2, "0");

/** Parse "YYYY-MM-DD" or "YYYY-MM-DD HH:mm" as local time. Returns null for anything else. */
export function parseLocalDateTime(text: string): number | null {
	const m = /^\s*(\d{4})-(\d{1,2})-(\d{1,2})(?:[ T](\d{1,2}):(\d{2}))?\s*$/.exec(text);
	if (!m) return null;
	const date = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), m[4] ? Number(m[4]) : 0, m[5] ? Number(m[5]) : 0, 0, 0);
	if (Number.isNaN(date.getTime()) || date.getMonth() !== Number(m[2]) - 1 || date.getDate() !== Number(m[3])) return null;
	return date.getTime();
}

export function formatLocalDateTime(ms: number): string {
	const d = new Date(ms);
	return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
