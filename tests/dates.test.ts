import { describe, expect, it } from "vitest";
import { formatLocalDateTime, parseLocalDateTime } from "../src/dates";

describe("parseLocalDateTime", () => {
	it("reads dates with and without a time", () => {
		expect(parseLocalDateTime("2026-09-05")).toBe(new Date(2026, 8, 5).getTime());
		expect(parseLocalDateTime(" 2026-09-05 16:10 ")).toBe(new Date(2026, 8, 5, 16, 10).getTime());
		expect(parseLocalDateTime("2026-9-5T7:05")).toBe(new Date(2026, 8, 5, 7, 5).getTime());
	});
	it("rejects nonsense", () => {
		expect(parseLocalDateTime("yesterday")).toBeNull();
		expect(parseLocalDateTime("2026-13-01")).toBeNull();
		expect(parseLocalDateTime("2026-02-30")).toBeNull();
		expect(parseLocalDateTime("")).toBeNull();
	});
	it("round-trips through formatLocalDateTime", () => {
		const ms = new Date(2026, 0, 9, 8, 3).getTime();
		expect(formatLocalDateTime(ms)).toBe("2026-01-09 08:03");
		expect(parseLocalDateTime(formatLocalDateTime(ms))).toBe(ms);
	});
});
