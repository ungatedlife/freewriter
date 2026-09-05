import { App, Modal } from "obsidian";
import type { RunReport } from "../sync/engine";

const MAX_ROWS = 500;

export class PreviewModal extends Modal {
	constructor(
		app: App,
		private readonly report: RunReport,
		private readonly onConfirm?: () => void,
	) {
		super(app);
	}

	onOpen(): void {
		const r = this.report;
		const c = r.counts;
		this.titleEl.setText(r.dryRun ? "Sync preview" : "Sync results");
		const { contentEl } = this;
		contentEl.empty();

		const parts = [
			`${c.create} to create`,
			`${c.update} to update`,
			`${c.conflict} conflict${c.conflict === 1 ? "" : "s"}`,
			`${c.adopt} to link`,
			`${c.move} moved`,
			`${c.skip} skipped`,
			`${c.missing} missing`,
			`${r.unchanged} unchanged`,
			`${r.ignored} older ignored`,
			`${c.error} error${c.error === 1 ? "" : "s"}`,
		];
		contentEl.createDiv({ cls: "fw-summary", text: parts.join(" · ") });
		if (r.dryRun) {
			contentEl.createEl("p", { text: "Nothing has been written yet.", cls: "fw-muted" });
		}

		if (!r.items.length) {
			contentEl.createEl("p", { text: "Nothing to do.", cls: "fw-muted" });
		} else {
			const wrap = contentEl.createDiv({ cls: "fw-preview" });
			const table = wrap.createEl("table");
			const head = table.createEl("thead").createEl("tr");
			for (const h of ["Action", "Route", "Draft", "Note"]) head.createEl("th", { text: h });
			const body = table.createEl("tbody");
			for (const item of r.items.slice(0, MAX_ROWS)) {
				const tr = body.createEl("tr");
				tr.createEl("td", { text: item.kind });
				tr.createEl("td", { text: item.route });
				tr.createEl("td", { text: item.source });
				const note = tr.createEl("td", { text: item.note ?? "" });
				if (item.detail) note.setAttribute("title", item.detail);
			}
			if (r.items.length > MAX_ROWS) {
				wrap.createEl("p", { text: `…and ${r.items.length - MAX_ROWS} more`, cls: "fw-muted" });
			}
		}

		if (r.dryRun && this.onConfirm) {
			const actions = contentEl.createDiv({ cls: "modal-button-container" });
			const button = actions.createEl("button", { text: "Sync now", cls: "mod-cta" });
			button.addEventListener("click", () => {
				this.close();
				this.onConfirm?.();
			});
		}
	}

	onClose(): void {
		this.contentEl.empty();
	}
}
