import { App, Modal } from "obsidian";
import type { LogEvent } from "../sync/engine";

const pad = (n: number): string => String(n).padStart(2, "0");

export class LogModal extends Modal {
	constructor(
		app: App,
		private readonly events: () => LogEvent[],
	) {
		super(app);
	}

	onOpen(): void {
		this.titleEl.setText("Freewriter sync log");
		const { contentEl } = this;
		contentEl.empty();
		const events = this.events().slice().reverse();
		if (!events.length) {
			contentEl.createEl("p", { text: "Nothing has happened yet.", cls: "fw-muted" });
			return;
		}
		const list = contentEl.createDiv({ cls: "fw-log" });
		for (const e of events) {
			const t = new Date(e.time);
			const stamp = `${pad(t.getHours())}:${pad(t.getMinutes())}:${pad(t.getSeconds())}`;
			const row = list.createDiv({ cls: `fw-log-row is-${e.level}` });
			row.setText(`${stamp}  ${e.route ? `[${e.route}] ` : ""}${e.message}`);
		}
	}

	onClose(): void {
		this.contentEl.empty();
	}
}
