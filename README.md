# Bridge

Bridge is an Obsidian plugin that brings drafts written on a [Freewrite](https://getfreewrite.com) into your vault. Point it at the folder Postbox syncs to (Dropbox, Google Drive or OneDrive), decide where each of the A, B and C folders should land, give each one a note template, and every draft becomes a proper note with the front matter you want. When you keep writing on the Freewrite, the note updates.

It replaces the folder-mirroring hacks that make duplicates, forget where you moved things, and add nothing to the notes they copy.

## What it does

- **One route per draft folder.** A route maps a folder on disk to a folder in your vault. Detect your Postbox folders and Bridge proposes one route for A, B and C. Point them wherever you like, or use a single route if you only write in one folder.
- **A template per route.** Each route has a note template: the whole note, front matter included, with `{{content}}` where the draft goes. Morning pages can get `date` and a tag; essays can get `type`, `status` and `topics`. Whatever your vault expects.
- **Notes keep following their draft.** Bridge writes one property into each note it creates (`bridge_source` by default). Rename the note, move it three folders deep, sync it to another machine; the next time the draft changes, the update finds it. No duplicates.
- **Your edits are never overwritten silently.** By default a note is refreshed from the draft until you edit its body in Obsidian. After that, a new version of the draft lands in a copy beside your note, so both versions survive. You can also choose "always overwrite" or "import once" per route.
- **Live and reliable.** Source folders are watched, so a draft appears a few seconds after Dropbox downloads it. A full check runs when Obsidian starts and every ten minutes as a fallback. A small state file remembers what has been synced, so a restart or plugin update never re-imports your whole archive.

## What it deliberately does not do

- It never writes into the Postbox folder. Freewrite sync is one-way and, as Freewrite documents, editing inside that folder creates duplicate drafts.
- It never deletes a note. When a draft disappears from its folder, the note is flagged with `bridge_status: source-missing` and left alone.
- It does not talk to Dropbox or Google Drive directly. It reads the local folder their desktop apps maintain.

## Setup

1. Install the plugin (see below) and enable it.
2. Open **Settings → Bridge** and press **Detect Freewrite folders**. Bridge finds the Postbox folder inside Dropbox, Google Drive or OneDrive and adds one disabled route per draft folder. If nothing is found, press **Add route** and paste the folder path.
3. Each route is a card. Press **Configure** to open its own page and set the destination folder, the note file name and the note template.
4. Enable the routes you want, then press **Preview**. The preview lists exactly what would be created without writing anything.
5. Press **Sync now**. From then on Bridge keeps up on its own.

### Template variables

| Variable | Meaning |
|---|---|
| `{{content}}` | The draft text. Required in the note template; appended if missing. |
| `{{title}}` | First line of the draft when it is short (80 characters or fewer), otherwise the first 80 characters. |
| `{{date}}` | The date the draft was started, taken from Postbox's file name. Default format `YYYY-MM-DD`. |
| `{{date:M-D-YYYY}}` | Any [moment](https://momentjs.com/docs/#/displaying/format/) format works, for `date`, `modified` and `now`. |
| `{{modified}}` | When the source file last changed. |
| `{{now}}` | When the note was written. |
| `{{folder}}` | Name of the source folder, e.g. `A`. |
| `{{route}}` | Name of the route. |
| `{{filename}}` | Source file name without its extension. |
| `{{source}}` | The identity value, e.g. `A/2026-05-07 Time.md`. |
| `{{words}}` | Word count of the draft. |

Example route for morning pages, saved as `MP 5-7-2026.md`:

- Note file name: `MP {{date:M-D-YYYY}}`
- Note template:

```markdown
---
date: {{date}}
tags:
  - freewriting
---
## morning pages

{{content}}
```

Example route for essays that feed a publishing pipeline:

```markdown
---
type: writing
status: draft
description: 
date: {{date}}
topics: []
---
{{content}}
```

### When a draft changes

Per route, choose what happens when a draft you already imported changes on the Freewrite:

- **Keep in sync until I edit the note in Obsidian** (default). The body is replaced and your properties are kept. Once you edit the body in Obsidian, the note is yours: the next version of the draft is written to a copy named like `Title (updated 2026-08-06 19-01).md`, and the original gets `bridge_status: detached`.
- **Always overwrite the body.** Good for journaling folders you never edit in Obsidian.
- **Import once, never update.** A pure inbox.

The template is rendered when a note is created. On updates only the part below the front matter is re-rendered, so properties you add or change in Obsidian survive.

### Commands

- **Sync now**, **Preview sync (dry run)**, **Show sync log**, **Detect Freewrite folders**
- **Detach current note from its draft**: stop updating this note. New versions of the draft will create a new note.
- **Reveal source draft of current note**: shows the original file in Finder or Explorer.
- **Link existing notes by file name**: if you already have copies of your drafts in the vault (from a folder-sync tool, for example), this links each unrecorded draft to the note with the same file name instead of importing it again. The note is treated as up to date from that moment.

## Good to know

- **Postbox naming.** Postbox names files `YYYY-MM-DD <first line>.md` and never renames them afterwards, even when you change the first line later. Bridge relies on that: the file name is the draft's identity. Older exports named `YYYY-MMM-DD …` and `.txt` files are handled too.
- **Google Drive streaming.** If Google Drive keeps files online-only, reading a draft forces a download and can stall. Mark the Postbox folder as available offline.
- **Two devices.** Run Bridge on the machine where the cloud folder is. Notes reach your other devices through whatever vault sync you already use. The identity property means a second Bridge install would recognise the notes rather than duplicate them.
- **Deleted a note?** If you delete a note Bridge created and the draft changes later, the draft is imported again. Detach the note instead if you want it gone for good, or set the route to import once.

## Privacy and file access

Bridge reads files from folders outside your vault: only the source folders you configure in its settings, and only files ending in `.md` or `.txt`. It writes notes into your vault and a `state.json` inside its own plugin folder. It makes no network requests and collects no telemetry.

## Installing

Bridge is not yet in the community plugin directory. Until it is:

- Install [BRAT](https://github.com/TfTHacker/obsidian42-brat) and add `ungatedlife/bridge` as a beta plugin, or
- download `main.js`, `manifest.json` and `styles.css` from the latest release into `<vault>/.obsidian/plugins/bridge/` and enable Bridge under **Settings → Community plugins**.

Desktop only: it needs file system access that Obsidian's mobile apps do not provide.

## Development

```bash
npm install
npm run dev      # rebuilds main.js on change
npm test         # unit tests for the parsing, templating and sync decisions
npm run build    # type-check and produce a minified main.js
```

The pieces that decide what happens (`src/adapters`, `src/template.ts`, `src/sync/scanner.ts`, `src/sync/linker.ts`) have no Obsidian imports and are covered by tests. The Obsidian-facing code lives in `src/sync/engine.ts`, `src/sync/writer.ts`, `src/ui` and `src/main.ts`.

## License

MIT
