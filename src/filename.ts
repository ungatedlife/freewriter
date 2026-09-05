/** Characters Obsidian refuses in file names, plus the ones that break wikilinks. */
const ILLEGAL = /[\\/:*?"<>|#^[\]]/g;
const MAX_LENGTH = 180;

export function sanitizeFilename(name: string, fallback = "Untitled"): string {
	let s = name.replace(ILLEGAL, " ").replace(/\s+/g, " ").trim();
	s = s.replace(/^\.+/, "").replace(/[. ]+$/, "").trim();
	if (s.length > MAX_LENGTH) s = s.slice(0, MAX_LENGTH).trim();
	return s || fallback;
}

/** Append " (2)", " (3)", … until `exists` says the candidate is free. */
export function uniqueName(base: string, exists: (candidate: string) => boolean): string {
	if (!exists(base)) return base;
	for (let i = 2; i < 1000; i++) {
		const candidate = `${base} (${i})`;
		if (!exists(candidate)) return candidate;
	}
	return `${base} (${Date.now()})`;
}

/** Join a vault folder and a file name. "" and "/" both mean the vault root. */
export function joinVaultPath(folder: string, name: string): string {
	const f = folder.replace(/^\/+|\/+$/g, "");
	return f ? `${f}/${name}` : name;
}

export function parentFolder(vaultPath: string): string {
	const i = vaultPath.lastIndexOf("/");
	return i === -1 ? "" : vaultPath.slice(0, i);
}
