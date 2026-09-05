import { describe, expect, it } from "vitest";
import { detectPostboxRoots, type DetectDeps } from "../src/detect";

function fakeDeps(dirs: Record<string, string[]>, links: Record<string, string> = {}): DetectDeps {
	return {
		home: "/Users/x",
		platform: "darwin",
		isDir: (p) => p in dirs,
		listDirs: (p) => dirs[p] ?? [],
		realpath: (p) => links[p] ?? p,
	};
}

describe("detectPostboxRoots", () => {
	it("finds Dropbox and Google Drive roots under CloudStorage", () => {
		const cs = "/Users/x/Library/CloudStorage";
		const deps = fakeDeps({
			[cs]: ["Dropbox", "GoogleDrive-me@x.com"],
			[`${cs}/Dropbox/Apps/Postbox`]: ["A", "B", "C", ".DS_Store"],
			[`${cs}/GoogleDrive-me@x.com/My Drive/Postbox`]: ["A", "B", "C"],
		});
		const roots = detectPostboxRoots(deps);
		expect(roots.map((r) => r.root)).toEqual([`${cs}/Dropbox/Apps/Postbox`, `${cs}/GoogleDrive-me@x.com/My Drive/Postbox`]);
		expect(roots[0].folders).toEqual([`${cs}/Dropbox/Apps/Postbox/A`, `${cs}/Dropbox/Apps/Postbox/B`, `${cs}/Dropbox/Apps/Postbox/C`]);
	});

	it("collapses a symlinked duplicate", () => {
		const cs = "/Users/x/Library/CloudStorage";
		const deps = fakeDeps(
			{
				[cs]: ["Dropbox"],
				[`${cs}/Dropbox/Apps/Postbox`]: ["A"],
				"/Users/x/Dropbox (Personal)/Apps/Postbox": ["A"],
			},
			{ "/Users/x/Dropbox (Personal)/Apps/Postbox": `${cs}/Dropbox/Apps/Postbox` },
		);
		expect(detectPostboxRoots(deps)).toHaveLength(1);
	});

	it("falls back to any subfolders when there are no lettered ones", () => {
		const deps = fakeDeps({ "/Users/x/Dropbox/Postbox": ["Drafts", "Ideas"] });
		expect(detectPostboxRoots(deps)[0].folders).toEqual(["/Users/x/Dropbox/Postbox/Drafts", "/Users/x/Dropbox/Postbox/Ideas"]);
	});

	it("returns nothing when no folder exists", () => {
		expect(detectPostboxRoots(fakeDeps({}))).toEqual([]);
	});
});
