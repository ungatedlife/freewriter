import type { AdapterId } from "../settings";
import { genericAdapter } from "./generic";
import { postboxAdapter } from "./postbox";
import type { SourceAdapter } from "./types";

export const ADAPTERS: Record<AdapterId, SourceAdapter> = {
	postbox: postboxAdapter,
	generic: genericAdapter,
};

export function getAdapter(id: AdapterId): SourceAdapter {
	return ADAPTERS[id] ?? postboxAdapter;
}

export type { SourceAdapter, ParsedDraft, SourceStats } from "./types";
