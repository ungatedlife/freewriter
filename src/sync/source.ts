import * as fs from "fs";
import * as path from "path";

export interface SourceEntry {
	/** Absolute path. */
	path: string;
	name: string;
	size: number;
	mtimeMs: number;
	birthtimeMs: number;
}

/** List the files in a source folder that the adapter cares about. Not recursive: Postbox folders are flat. */
export async function listSourceFolder(folder: string, matches: (name: string) => boolean): Promise<SourceEntry[]> {
	const dirents = await fs.promises.readdir(folder, { withFileTypes: true });
	const out: SourceEntry[] = [];
	for (const d of dirents) {
		if (!d.isFile()) continue;
		if (d.name.startsWith(".") || d.name.startsWith("~$")) continue;
		if (!matches(d.name)) continue;
		const full = path.join(folder, d.name);
		try {
			const st = await fs.promises.stat(full);
			out.push({ path: full, name: d.name, size: st.size, mtimeMs: st.mtimeMs, birthtimeMs: st.birthtimeMs });
		} catch {
			// The file vanished between readdir and stat; the next run will see the folder as it is then.
		}
	}
	out.sort((a, b) => a.name.localeCompare(b.name));
	return out;
}

export function readSourceFile(p: string): Promise<string> {
	return fs.promises.readFile(p, "utf8");
}

export function sourceExists(p: string): boolean {
	try {
		return fs.statSync(p).isFile();
	} catch {
		return false;
	}
}
