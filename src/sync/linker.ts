import type { UpdatePolicy } from "../settings";

export type Decision = "create" | "overwrite" | "conflict" | "skip-once";

/**
 * Decide what a changed draft does to its linked note.
 * With the "sync" policy the body is compared against what Bridge last wrote:
 * untouched → overwrite; edited in Obsidian → conflict copy. No baseline → conflict, to be safe.
 */
export function decideUpdate(
	policy: UpdatePolicy,
	noteExists: boolean,
	currentBodyHash: string | null,
	lastWrittenBodyHash: string | null,
): Decision {
	if (!noteExists) return "create";
	if (policy === "once") return "skip-once";
	if (policy === "overwrite") return "overwrite";
	if (lastWrittenBodyHash === null || currentBodyHash === null) return "conflict";
	return currentBodyHash === lastWrittenBodyHash ? "overwrite" : "conflict";
}
