import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { App as ObsidianApp, TFile as ObsidianTFile } from "obsidian";
import { App, TFile, parseYaml } from "./mocks/obsidian";
import { frontMatterYaml, splitFrontMatter } from "../src/frontmatter";
import type { AiClient } from "../src/ai/openrouter";
import { newRoute, normalizeSettings, type FreewriterSettings, type Route } from "../src/settings";
import { emptyState, type SyncState } from "../src/state";
import { SyncEngine } from "../src/sync/engine";
import { formatDateBasic } from "../src/template";

const A_PROPERTIES = [
	{ key: "date", type: "date" as const, value: "{{date}}" },
	{ key: "tags", type: "list" as const, value: "freewriting" },
];
const B_PROPERTIES = [
	{ key: "date", type: "date" as const, value: "{{date}}" },
	{ key: "tags", type: "list" as const, value: "dialogic" },
	{ key: "project", type: "text" as const, value: "[[Dialogic Studio]]" },
];

let tmp: string;
let app: App;
let settings: FreewriterSettings;
let state: SyncState;
let engine: SyncEngine;
let saves = 0;
let clock = 1_780_000_000_000;

function src(folder: string, name: string): string {
	return path.join(tmp, folder, name);
}

/** Write a source file with a strictly increasing mtime, like a fresh Dropbox download. */
function writeSource(folder: string, name: string, content: string): void {
	const p = src(folder, name);
	fs.mkdirSync(path.dirname(p), { recursive: true });
	fs.writeFileSync(p, content);
	clock += 5_000;
	fs.utimesSync(p, new Date(clock), new Date(clock));
}

function note(vaultPath: string): TFile {
	const f = app.vault.getAbstractFileByPath(vaultPath);
	if (!(f instanceof TFile)) throw new Error(`no note at ${vaultPath}`);
	return f;
}

function text(vaultPath: string): string {
	return app.vault.files.get(vaultPath) ?? (() => { throw new Error(`no note at ${vaultPath}`); })();
}

function props(vaultPath: string): Record<string, unknown> {
	const { frontmatter } = splitFrontMatter(text(vaultPath));
	return frontmatter ? (parseYaml(frontMatterYaml(frontmatter)) as Record<string, unknown>) : {};
}

function body(vaultPath: string): string {
	return splitFrontMatter(text(vaultPath)).body;
}

function makeEngine(ai: AiClient | null = null): SyncEngine {
	return new SyncEngine(
		app as unknown as ObsidianApp,
		() => settings,
		() => state,
		async () => {
			saves++;
		},
		formatDateBasic,
		() => undefined,
		() => ai,
	);
}

beforeEach(() => {
	tmp = fs.mkdtempSync(path.join(os.tmpdir(), "bridge-test-"));
	app = new App();
	state = emptyState();
	saves = 0;
	const routeA: Route = newRoute({
		id: "a",
		name: "Freewrite A",
		enabled: true,
		sourcePath: path.join(tmp, "A"),
		destination: "Freewriting/Morning pages",
		filenameTemplate: "MP {{date:M-D-YYYY}}",
		properties: A_PROPERTIES,
		bodyTemplate: "## morning pages\n\n{{content}}",
	});
	const routeB: Route = newRoute({
		id: "b",
		name: "Freewrite B",
		enabled: true,
		sourcePath: path.join(tmp, "B"),
		destination: "Writing/Dialogic Studio",
		filenameTemplate: "{{title}}",
		properties: B_PROPERTIES,
	});
	settings = normalizeSettings({ routes: [routeA, routeB] });
	fs.mkdirSync(path.join(tmp, "A"));
	fs.mkdirSync(path.join(tmp, "B"));
	writeSource("A", "2026-05-07 Time.md", "Time\r\n\r\nOk, picking up here.\r\n");
	writeSource(
		"A",
		"2026-01-27 I-m feeling anxious this morning Ugh Fuck fuk fuck I don-t want to do anythin.md",
		"I'm feeling anxious this morning. Ugh. Fuck fuk fuck. I don't want to do anything. I want to go back to bed.\r\n\r\nSecond paragraph.\r\n",
	);
	writeSource("B", "2026-08-19 Befriending tech let.md", "Befriending tech letter\r\n\r\nDear fellow human,\r\n");
	engine = makeEngine();
});

afterEach(() => {
	fs.rmSync(tmp, { recursive: true, force: true });
});

describe("first import", () => {
	it("creates one templated note per draft with the identity property", async () => {
		const report = await engine.run();
		expect(report.counts.create).toBe(3);
		expect(report.counts.error).toBe(0);
		expect(saves).toBe(1);

		const time = "Freewriting/Morning pages/MP 5-7-2026.md";
		expect(props(time)).toEqual({ date: "2026-05-07", tags: ["freewriting"], freewriter_source: "A/2026-05-07 Time.md" });
		expect(body(time)).toBe("## morning pages\n\nOk, picking up here.\n");

		const anxious = "Freewriting/Morning pages/MP 1-27-2026.md";
		expect(body(anxious).startsWith("## morning pages\n\nI'm feeling anxious this morning.")).toBe(true);

		const letter = "Writing/Dialogic Studio/Befriending tech letter.md";
		expect(props(letter)).toEqual({
			date: "2026-08-19",
			tags: ["dialogic"],
			project: "[[Dialogic Studio]]",
			freewriter_source: "B/2026-08-19 Befriending tech let.md",
		});
		expect(body(letter)).toBe("Dear fellow human,\n");

		const rec = state.records[src("A", "2026-05-07 Time.md")];
		expect(rec.notePath).toBe(time);
		expect(rec.bodyHash).toBeTruthy();
		expect(rec.status).toBe("synced");
	});

	it("is a no-op the second time", async () => {
		await engine.run();
		const report = await engine.run();
		expect(report.items).toEqual([]);
		expect(report.unchanged).toBe(3);
	});

	it("gives same-day drafts distinct names", async () => {
		writeSource("A", "2026-05-07 Another one.md", "Another one\r\n\r\nText.\r\n");
		await engine.run();
		expect(app.vault.files.has("Freewriting/Morning pages/MP 5-7-2026.md")).toBe(true);
		expect(app.vault.files.has("Freewriting/Morning pages/MP 5-7-2026 (2).md")).toBe(true);
	});

	it("writes nothing on a dry run", async () => {
		const preview = await engine.run({ dryRun: true });
		expect(preview.counts.create).toBe(3);
		expect(app.vault.files.size).toBe(0);
		expect(Object.keys(state.records)).toHaveLength(0);
		expect(saves).toBe(0);
	});

	it("skips disabled routes", async () => {
		settings.routes[1].enabled = false;
		const report = await engine.run();
		expect(report.counts.create).toBe(2);
	});
});

describe("updates", () => {
	const time = "Freewriting/Morning pages/MP 5-7-2026.md";

	it("replaces the body and keeps properties added in Obsidian", async () => {
		await engine.run();
		await app.fileManager.processFrontMatter(note(time), (fm) => {
			fm.status = "reviewed";
		});
		// A property edit alone must not count as an edit of the body.
		writeSource("A", "2026-05-07 Time.md", "Time\r\n\r\nOk, picking up here.\r\nAnd a bit more.\r\n");
		const report = await engine.run();
		expect(report.counts.update).toBe(1);
		expect(report.counts.conflict).toBe(0);
		expect(body(time)).toBe("## morning pages\n\nOk, picking up here.\nAnd a bit more.\n");
		expect(props(time).status).toBe("reviewed");
		expect(props(time).freewriter_source).toBe("A/2026-05-07 Time.md");
	});

	it("follows a note that was renamed and moved inside the vault", async () => {
		await engine.run();
		await app.vault.createFolder("Series");
		await app.vault.rename(note(time), "Series/On time.md");
		writeSource("A", "2026-05-07 Time.md", "Time\r\n\r\nRewritten.\r\n");
		const report = await engine.run();
		expect(report.counts.update).toBe(1);
		expect(report.counts.create).toBe(0);
		expect(body("Series/On time.md")).toBe("## morning pages\n\nRewritten.\n");
		expect(app.vault.files.has(time)).toBe(false);
		expect(state.records[src("A", "2026-05-07 Time.md")].notePath).toBe("Series/On time.md");
	});

	it("keeps your edits and lands the new draft in a copy on conflict", async () => {
		await engine.run();
		const edited = text(time).replace("Ok, picking up here.", "Ok, picking up here. [my edit]");
		await app.vault.modify(note(time), edited);
		writeSource("A", "2026-05-07 Time.md", "Time\r\n\r\nContinued on the Freewrite.\r\n");
		const report = await engine.run();
		expect(report.counts.conflict).toBe(1);
		expect(report.counts.update).toBe(0);

		expect(body(time)).toContain("[my edit]");
		expect(props(time).freewriter_source).toBeUndefined();
		expect(props(time).freewriter_status).toBe("detached");

		const copies = Array.from(app.vault.files.keys()).filter((p) => p.startsWith("Freewriting/Morning pages/MP 5-7-2026 (updated"));
		expect(copies).toHaveLength(1);
		expect(body(copies[0])).toBe("## morning pages\n\nContinued on the Freewrite.\n");
		expect(props(copies[0]).freewriter_source).toBe("A/2026-05-07 Time.md");
		expect(state.records[src("A", "2026-05-07 Time.md")].notePath).toBe(copies[0]);
		expect(state.records[src("A", "2026-05-07 Time.md")].status).toBe("conflict");

		// The copy is now the live note: a further draft change updates it in place.
		writeSource("A", "2026-05-07 Time.md", "Time\r\n\r\nAnd again.\r\n");
		const again = await engine.run();
		expect(again.counts.update).toBe(1);
		expect(body(copies[0])).toBe("## morning pages\n\nAnd again.\n");
	});

	it("always overwrites under the overwrite policy", async () => {
		settings.routes[0].updatePolicy = "overwrite";
		await engine.run();
		await app.vault.modify(note(time), text(time) + "my edit\n");
		writeSource("A", "2026-05-07 Time.md", "Time\r\n\r\nNew.\r\n");
		const report = await engine.run();
		expect(report.counts.update).toBe(1);
		expect(body(time)).toBe("## morning pages\n\nNew.\n");
	});

	it("never touches the note under the once policy", async () => {
		settings.routes[0].updatePolicy = "once";
		await engine.run();
		writeSource("A", "2026-05-07 Time.md", "Time\r\n\r\nNew.\r\n");
		const report = await engine.run();
		expect(report.counts.skip).toBe(1);
		expect(body(time)).toBe("## morning pages\n\nOk, picking up here.\n");
		// And it is not re-reported on the next run.
		expect((await engine.run()).items).toEqual([]);
	});

	it("ignores a touch that leaves the text unchanged", async () => {
		await engine.run();
		const p = src("A", "2026-05-07 Time.md");
		clock += 5_000;
		fs.utimesSync(p, new Date(clock), new Date(clock));
		const report = await engine.run();
		expect(report.items).toEqual([]);
		expect(report.unchanged).toBe(3);
	});

	it("re-imports a draft whose note was deleted, once the draft changes", async () => {
		await engine.run();
		await app.vault.delete(note(time));
		expect((await engine.run()).items).toEqual([]);
		writeSource("A", "2026-05-07 Time.md", "Time\r\n\r\nBack.\r\n");
		const report = await engine.run();
		expect(report.counts.create).toBe(1);
		expect(body(time)).toBe("## morning pages\n\nBack.\n");
	});
});

describe("missing, moved and detached drafts", () => {
	const time = "Freewriting/Morning pages/MP 5-7-2026.md";

	it("flags a note whose draft vanished and clears the flag when it returns", async () => {
		await engine.run();
		fs.rmSync(src("A", "2026-05-07 Time.md"));
		const report = await engine.run();
		expect(report.counts.missing).toBe(1);
		expect(props(time).freewriter_status).toBe("source-missing");
		expect(app.vault.files.has(time)).toBe(true);
		expect((await engine.run()).counts.missing).toBe(0);

		writeSource("A", "2026-05-07 Time.md", "Time\r\n\r\nOk, picking up here.\r\n");
		const back = await engine.run();
		expect(back.counts.create).toBe(0);
		expect(props(time).freewriter_status).toBeUndefined();
		expect(state.records[src("A", "2026-05-07 Time.md")].status).toBe("synced");
	});

	it("re-links a draft moved to another folder on the device", async () => {
		await engine.run();
		const letter = "Writing/Dialogic Studio/Befriending tech letter.md";
		fs.rmSync(src("B", "2026-08-19 Befriending tech let.md"));
		writeSource("A", "2026-08-19 Befriending tech let.md", "Befriending tech letter\r\n\r\nDear fellow human,\r\n");
		const report = await engine.run();
		expect(report.counts.move).toBe(1);
		expect(report.counts.create).toBe(0);
		expect(report.counts.missing).toBe(0);
		expect(props(letter).freewriter_source).toBe("A/2026-08-19 Befriending tech let.md");
		expect(state.records[src("A", "2026-08-19 Befriending tech let.md")].routeId).toBe("a");
		expect(state.records[src("B", "2026-08-19 Befriending tech let.md")]).toBeUndefined();
	});

	it("detaching stops updates and sends the next version to a new note", async () => {
		await engine.run();
		const rec = engine.recordForNote(time);
		expect(rec).not.toBeNull();
		await engine.detachNote(note(time) as unknown as ObsidianTFile, rec!);
		expect(props(time).freewriter_source).toBeUndefined();
		expect(props(time).freewriter_status).toBe("detached");
		writeSource("A", "2026-05-07 Time.md", "Time\r\n\r\nNew version.\r\n");
		const report = await engine.run();
		expect(report.counts.create).toBe(1);
		expect(body("Freewriting/Morning pages/MP 5-7-2026 (2).md")).toBe("## morning pages\n\nNew version.\n");
		expect(body(time)).toBe("## morning pages\n\nOk, picking up here.\n");
	});
});

describe("recovery", () => {
	it("adopts notes that carry the identity property when the state is lost", async () => {
		await engine.run();
		state = emptyState();
		engine = makeEngine();
		const report = await engine.run();
		expect(report.counts.adopt).toBe(3);
		expect(report.counts.create).toBe(0);
		expect(app.vault.getMarkdownFiles()).toHaveLength(3);
		// Adopted notes are treated as in sync, so a later change updates them in place.
		writeSource("A", "2026-05-07 Time.md", "Time\r\n\r\nAfter reinstall.\r\n");
		expect((await engine.run()).counts.update).toBe(1);
	});

	it("links existing copies by file name instead of importing them again", async () => {
		await app.vault.createFolder("Inbox");
		await app.vault.create("Inbox/2026-05-07 Time.md", "Time\n\nOk, picking up here.\n");
		const linked = await engine.linkExistingByName();
		expect(linked).toBe(1);
		expect(props("Inbox/2026-05-07 Time.md").freewriter_source).toBe("A/2026-05-07 Time.md");
		const report = await engine.run();
		expect(report.counts.create).toBe(2);
		expect(app.vault.files.has("Freewriting/Morning pages/MP 5-7-2026.md")).toBe(false);
	});

	it("reports an unreadable source folder as an error and carries on", async () => {
		settings.routes[0].sourcePath = path.join(tmp, "nope");
		const report = await engine.run();
		expect(report.counts.error).toBe(1);
		expect(report.counts.create).toBe(1);
	});

	it("never overwrites an unrelated note that already has the target name", async () => {
		await app.vault.createFolder("Writing");
		await app.vault.createFolder("Writing/Dialogic Studio");
		await app.vault.create("Writing/Dialogic Studio/Befriending tech letter.md", "Mine.\n");
		await engine.run();
		expect(text("Writing/Dialogic Studio/Befriending tech letter.md")).toBe("Mine.\n");
		expect(body("Writing/Dialogic Studio/Befriending tech letter (2).md")).toBe("Dear fellow human,\n");
	});
});

describe("AI formatting", () => {
	const calls: Array<{ model: string; system: string; user: string }> = [];
	const fake: AiClient = {
		async complete(model, system, user) {
			calls.push({ model, system, user });
			return system.includes("name drafts") ? '"On Time."' : "- summary point";
		},
	};
	const failing: AiClient = {
		async complete() {
			throw new Error("boom");
		},
	};

	beforeEach(() => {
		calls.length = 0;
		settings.openRouterApiKey = "sk-test";
		settings.openRouterModel = "test/model";
		settings.routes[1].enabled = false;
		settings.routes[0].ai = { enabled: true, instructions: "Summarize it", placement: "above", title: true, titleInstructions: "Name it" };
		settings.routes[0].filenameTemplate = "{{ai_title}}";
		fs.rmSync(src("A", "2026-01-27 I-m feeling anxious this morning Ugh Fuck fuk fuck I don-t want to do anythin.md"));
		engine = makeEngine(fake);
	});

	it("places the result above the draft and names the note with the AI title", async () => {
		const report = await engine.run();
		expect(report.counts.create).toBe(1);
		const note = "Freewriting/Morning pages/On Time.md";
		expect(body(note)).toBe("- summary point\n\n## morning pages\n\nOk, picking up here.\n");
		expect(props(note).freewriter_source).toBe("A/2026-05-07 Time.md");
		expect(calls).toHaveLength(2);
		expect(calls.every((c) => c.model === "test/model")).toBe(true);
		expect(calls[0].user).toBe("Ok, picking up here.");
		expect(calls[0].system).toContain("Summarize it");
		expect(calls[1].system).toContain("Name it");
	});

	it("can put the result below or instead of the draft", async () => {
		settings.routes[0].ai.placement = "below";
		settings.routes[0].ai.title = false;
		await engine.run();
		expect(body("Freewriting/Morning pages/Time.md")).toBe("## morning pages\n\nOk, picking up here.\n\n- summary point\n");

		settings.routes[0].ai.placement = "replace";
		writeSource("A", "2026-05-07 Time.md", "Time\r\n\r\nChanged.\r\n");
		await engine.run();
		expect(body("Freewriting/Morning pages/Time.md")).toBe("## morning pages\n\n- summary point\n");
	});

	it("honours an explicit {{ai}} in the body and reruns on updates without a new title", async () => {
		settings.routes[0].bodyTemplate = "{{content}}\n\n---\n\n{{ai}}";
		await engine.run();
		const note = "Freewriting/Morning pages/On Time.md";
		expect(body(note)).toBe("Ok, picking up here.\n\n---\n\n- summary point\n");
		calls.length = 0;
		writeSource("A", "2026-05-07 Time.md", "Time\r\n\r\nMore words.\r\n");
		const report = await engine.run();
		expect(report.counts.update).toBe(1);
		expect(body(note)).toBe("More words.\n\n---\n\n- summary point\n");
		expect(calls).toHaveLength(1);
		expect(calls[0].system).toContain("Summarize it");
	});

	it("still imports when the model fails, and says so in the log", async () => {
		engine = makeEngine(failing);
		const report = await engine.run();
		expect(report.counts.create).toBe(1);
		expect(report.counts.error).toBe(0);
		expect(body("Freewriting/Morning pages/Time.md")).toBe("## morning pages\n\nOk, picking up here.\n");
		expect(engine.events.some((e) => e.level === "warn" && e.message.includes("AI formatting failed"))).toBe(true);
	});

	it("skips AI without a key and on dry runs", async () => {
		engine = makeEngine(null);
		const preview = await engine.run({ dryRun: true });
		expect(preview.counts.create).toBe(1);
		const report = await engine.run();
		expect(report.counts.create).toBe(1);
		expect(body("Freewriting/Morning pages/Time.md")).toBe("## morning pages\n\nOk, picking up here.\n");
		expect(engine.events.some((e) => e.level === "warn" && e.message.includes("no OpenRouter API key"))).toBe(true);
		expect(calls).toHaveLength(0);
	});
});
