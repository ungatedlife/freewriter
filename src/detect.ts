import * as fs from "fs";
import * as os from "os";
import * as path from "path";

export interface DetectDeps {
	home: string;
	platform: string;
	isDir: (p: string) => boolean;
	listDirs: (p: string) => string[];
	realpath: (p: string) => string;
}

export interface DetectedRoot {
	root: string;
	/** Absolute paths of the draft folders inside the root (A, B, C on a Freewrite). */
	folders: string[];
}

export function defaultDeps(): DetectDeps {
	return {
		home: os.homedir(),
		platform: process.platform,
		isDir: (p) => {
			try {
				return fs.statSync(p).isDirectory();
			} catch {
				return false;
			}
		},
		listDirs: (p) => {
			try {
				return fs
					.readdirSync(p, { withFileTypes: true })
					.filter((d) => d.isDirectory() || d.isSymbolicLink())
					.map((d) => d.name);
			} catch {
				return [];
			}
		},
		realpath: (p) => {
			try {
				return fs.realpathSync(p);
			} catch {
				return p;
			}
		},
	};
}

/** Every place a Postbox folder could live for the desktop clients of Dropbox, Google Drive and OneDrive. */
export function candidateRoots(deps: DetectDeps): string[] {
	const { home, platform } = deps;
	const parents: string[] = [];
	if (platform === "darwin") {
		const cloud = path.join(home, "Library", "CloudStorage");
		for (const name of deps.listDirs(cloud)) parents.push(path.join(cloud, name));
		parents.push(
			path.join(home, "Dropbox"),
			path.join(home, "Dropbox (Personal)"),
			path.join(home, "Google Drive"),
			path.join(home, "OneDrive"),
		);
	} else if (platform === "win32") {
		parents.push(
			path.join(home, "Dropbox"),
			path.join(home, "OneDrive"),
			path.join(home, "Google Drive"),
			path.join(home, "My Drive"),
		);
		for (const letter of "DEFGHIJKLMNOPQRSTUVWXYZ") parents.push(`${letter}:\\My Drive`);
	} else {
		parents.push(path.join(home, "Dropbox"), path.join(home, "OneDrive"), path.join(home, "Google Drive"));
	}
	const roots: string[] = [];
	for (const parent of parents) {
		roots.push(path.join(parent, "Postbox"));
		roots.push(path.join(parent, "Apps", "Postbox"));
		roots.push(path.join(parent, "My Drive", "Postbox"));
	}
	return roots;
}

export function detectPostboxRoots(deps: DetectDeps = defaultDeps()): DetectedRoot[] {
	const out: DetectedRoot[] = [];
	const seen = new Set<string>();
	for (const root of candidateRoots(deps)) {
		if (!deps.isDir(root)) continue;
		const real = deps.realpath(root);
		if (seen.has(real)) continue;
		seen.add(real);
		const subs = deps.listDirs(root).filter((n) => !n.startsWith("."));
		const letters = subs.filter((n) => /^[A-Z]$/.test(n));
		const folders = (letters.length ? letters : subs).sort().map((n) => path.join(root, n));
		out.push({ root, folders });
	}
	return out;
}
