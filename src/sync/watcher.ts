import * as fs from "fs";

/**
 * One non-recursive fs.watch per route folder, debounced so a Dropbox write
 * (temp file, rename, attribute change) turns into a single sync.
 */
export class FolderWatcher {
	private watchers = new Map<string, fs.FSWatcher>();
	private timers = new Map<string, ReturnType<typeof setTimeout>>();

	constructor(
		private onChange: (routeId: string) => void,
		private debounceMs: number,
	) {}

	setDebounce(ms: number): void {
		this.debounceMs = ms;
	}

	watch(routeId: string, folder: string): boolean {
		this.unwatch(routeId);
		try {
			const watcher = fs.watch(folder, { persistent: false }, () => this.schedule(routeId));
			watcher.on("error", () => this.unwatch(routeId));
			this.watchers.set(routeId, watcher);
			return true;
		} catch {
			return false;
		}
	}

	isWatching(routeId: string): boolean {
		return this.watchers.has(routeId);
	}

	private schedule(routeId: string): void {
		const existing = this.timers.get(routeId);
		if (existing) clearTimeout(existing);
		this.timers.set(
			routeId,
			setTimeout(() => {
				this.timers.delete(routeId);
				this.onChange(routeId);
			}, this.debounceMs),
		);
	}

	unwatch(routeId: string): void {
		const w = this.watchers.get(routeId);
		if (w) {
			try {
				w.close();
			} catch {
				// already closed
			}
			this.watchers.delete(routeId);
		}
		const t = this.timers.get(routeId);
		if (t) {
			clearTimeout(t);
			this.timers.delete(routeId);
		}
	}

	close(): void {
		for (const id of Array.from(this.watchers.keys())) this.unwatch(id);
	}
}
