# Freewriter

Freewriter is an Obsidian plugin that brings drafts written on a [Freewrite](https://getfreewrite.com) into your vault. Point it at the folder Postbox syncs to (Dropbox, Google Drive or OneDrive), decide where each of the A, B and C folders should land, pick the properties each one gets, and every draft becomes a proper note. Keep writing on the Freewrite and the note updates. Optionally, a model of your choice summarizes, formats or titles drafts on the way in.

It replaces the folder-mirroring hacks that make duplicates, forget where you moved things, and add nothing to the notes they copy.

## What it does

- **One route per draft folder.** A route maps a folder on disk to a folder in your vault. Detect your Postbox folders and Freewriter proposes one route for A, B and C. Point them wherever you like, or use a single route if you only write in one folder.
- **Properties without writing front matter.** Each route has a list of properties: name, type and value. Names and values are suggested from what already exists in your vault, so `type: writing` or `status: draft` is two clicks. Values can use variables such as `{{date}}` or `{{ai_title}}`.
- **Your own note names.** A template such as `MP {{date:M-D-YYYY}}` or `{{title}}`, per route.
- **Notes keep following their draft.** Freewriter writes one property into each note it creates (`freewriter_source` by default). Rename the note, move it three folders deep, sync it to another machine; the next time the draft changes, the update finds it. No duplicates.
- **Your edits are never overwritten silently.** By default a note is refreshed from the draft until you edit its body in Obsidian. After that, a new version of the draft lands in a copy beside your note, so both versions survive. You can also choose "always overwrite" or "import once" per route.
- **Optional AI, per route, through OpenRouter.** Give a route instructions in plain language ("add a bullet-point summary at the top") and pick where the result goes. Ask for AI titles and use `{{ai_title}}` in the note name. One OpenRouter key gives you every model they offer. Routes without AI never send anything anywhere.
- **Live and reliable.** Source folders are watched, so a draft appears a few seconds after Dropbox downloads it. A full check runs when Obsidian starts and every ten minutes as a fallback. A small state file remembers what has been synced, so a restart or plugin update never re-imports your whole archive.

## What it deliberately does not do

- It never writes into the Postbox folder. Freewrite sync is one-way and, as Freewrite documents, editing inside that folder creates duplicate drafts.
- It never deletes a note. When a draft disappears from its folder, the note is flagged with `freewriter_status: source-missing` and left alone.
- It does not talk to Dropbox or Google Drive directly. It reads the local folder their desktop apps maintain.

## Setup

1. Install the plugin (see below) and enable it.
2. Open **Settings → Freewriter** and press **Detect**. Freewriter finds the Postbox folder inside Dropbox, Google Drive or OneDrive and adds one disabled route per draft folder. If nothing is found, press **Add route** and paste the folder path.
3. Each route is a card. Press **Configure** to open its page: destination folder, note file name, properties, body, and what happens when a draft changes.
4. Enable the routes you want, then press **Preview**. The preview lists exactly what would be created without writing anything.
5. Press **Sync now**. From then on Freewriter keeps up on its own.

### Properties

Every property has a name, a type and a value:

| Type | Written as | Value examples |
|---|---|---|
| Text | `type: writing` | `writing`, `[[Dialogic Studio]]`, `{{ai_title}}` |
| List | `tags:` followed by items | `freewriting, morning-pages` |
| Number | `rank: 3` | `3` |
| Checkbox | `members: true` | on or off |
| Date | `date: 2026-05-07` | `{{date}}`, `{{now:YYYY-MM-DD}}` |

Names are suggested from properties already in your vault; when you pick one, its type is set to match and its existing values are offered. Properties are applied when a note is created. Later changes to the draft only refresh the body, so anything you add or edit in the note's properties survives.

### Variables

| Variable | Meaning |
|---|---|
| `{{content}}` | The draft text. Required in the body; appended if missing. |
| `{{title}}` | First line of the draft when it is short (80 characters or fewer), otherwise the first 80 characters. |
| `{{ai_title}}` | Title from the model when AI titles are on for the route, otherwise the same as `{{title}}`. |
| `{{ai}}` | Result of the route's AI instructions, or empty. |
| `{{date}}` | The date the draft was started, taken from Postbox's file name. Default format `YYYY-MM-DD`. |
| `{{date:M-D-YYYY}}` | Any [moment](https://momentjs.com/docs/#/displaying/format/) format works, for `date`, `modified` and `now`. |
| `{{modified}}` | When the source file last changed. |
| `{{now}}` | When the note was written. |
| `{{folder}}` | Name of the source folder, e.g. `A`. |
| `{{route}}` | Name of the route. |
| `{{filename}}` | Source file name without its extension. |
| `{{source}}` | The identity value, e.g. `A/2026-05-07 Time.md`. |
| `{{words}}` | Word count of the draft. |

Example: morning pages saved as `MP 5-7-2026.md` with a `date` property, a `freewriting` tag and a heading above the text. Note file name `MP {{date:M-D-YYYY}}`, properties `date` (Date, `{{date}}`) and `tags` (List, `freewriting`), body:

```markdown
## morning pages

{{content}}
```

### When a draft changes

Per route, choose what happens when a draft you already imported changes on the Freewrite:

- **Keep in sync until I edit it here** (default). The body is replaced and your properties are kept. Once you edit the body in Obsidian, the note is yours: the next version of the draft is written to a copy named like `Title (updated 2026-08-06 19-01).md`, and the original gets `freewriter_status: detached`.
- **Always overwrite the body.** Good for journaling folders you never edit in Obsidian.
- **Import once, never update.** A pure inbox.

### AI formatting

On the **AI formatting** page, paste an [OpenRouter](https://openrouter.ai/keys) API key and pick a model; the model list is searchable. Then, per route:

- **Instructions**: what the model should do with each draft, for example "Write a five-bullet summary of the key ideas" or "Fix obvious typos and split into paragraphs, changing nothing else." The result is available as `{{ai}}`.
- **Where the result goes**: above the draft, below it, or instead of it. Put `{{ai}}` in the body yourself to control the exact spot.
- **Title drafts with AI**: asks the model for a title when a note is created, available as `{{ai_title}}` for the note file name and properties.

The model runs when a note is created and again whenever the draft changes and the body is refreshed. Titles are generated once, at creation. If the request fails, the note is still created or updated without the AI text, and the sync log says why. Previews never call the model.

### Commands

- **Sync now**, **Preview sync (dry run)**, **Show sync log**, **Detect Freewrite folders**
- **Detach current note from its draft**: stop updating this note. New versions of the draft will create a new note.
- **Reveal source draft of current note**: shows the original file in Finder or Explorer.
- **Link existing notes by file name**: if you already have copies of your drafts in the vault (from a folder-sync tool, for example), this links each unrecorded draft to the note with the same file name instead of importing it again. The note is treated as up to date from that moment.

## Good to know

- **Postbox naming.** Postbox names files `YYYY-MM-DD <first line>.md` and never renames them afterwards, even when you change the first line later. Freewriter relies on that: the file name is the draft's identity. Older exports named `YYYY-MMM-DD …` and `.txt` files are handled too.
- **Google Drive streaming.** If Google Drive keeps files online-only, reading a draft forces a download and can stall. Mark the Postbox folder as available offline.
- **Two devices.** Run Freewriter on the machine where the cloud folder is. Notes reach your other devices through whatever vault sync you already use. The identity property means a second install would recognise the notes rather than duplicate them.
- **Deleted a note?** If you delete a note Freewriter created and the draft changes later, the draft is imported again. Detach the note instead if you want it gone for good, or set the route to import once.

## Privacy and file access

Freewriter reads files from folders outside your vault: only the source folders you configure in its settings, and only files ending in `.md` or `.txt`. It writes notes into your vault and a `state.json` inside its own plugin folder.

It makes network requests only if you set up AI formatting: the draft text of routes with AI switched on is sent to OpenRouter (openrouter.ai) with your instructions, and the model list is fetched from the same service. Your API key is stored in the plugin's settings file inside your vault, so keep that in mind if you sync or share the vault. Routes without AI never send anything. There is no telemetry.

## Installing

Freewriter is not yet in the community plugin directory. Until it is:

- Install [BRAT](https://github.com/TfTHacker/obsidian42-brat) and add `ungatedlife/bridge` as a beta plugin, or
- download `main.js`, `manifest.json` and `styles.css` from the latest release into `<vault>/.obsidian/plugins/freewriter/` and enable Freewriter under **Settings → Community plugins**.

Desktop only: it needs file system access that Obsidian's mobile apps do not provide.

## Development

```bash
npm install
npm run dev      # rebuilds main.js on change
npm test         # unit tests plus end-to-end engine tests against a mocked vault
npm run build    # type-check and produce a minified main.js
```

The pieces that decide what happens (`src/adapters`, `src/template.ts`, `src/yaml.ts`, `src/sync/scanner.ts`, `src/sync/linker.ts`) have no Obsidian imports and are covered by unit tests. `src/sync/engine.ts` is exercised end to end in `tests/engine.test.ts` against the small Obsidian stand-in in `tests/mocks/obsidian.ts`. The UI lives in `src/ui` and the plugin entry point in `src/main.ts`.

## License

MIT
