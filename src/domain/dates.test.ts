import { expect, test } from "bun:test";

import { addDays, dateRange, isIsoDate, utcDate } from "./dates";

test("isIsoDate accepts real calendar dates only", () => {
  expect(isIsoDate("2026-10-23")).toBe(true);
  expect(isIsoDate("2024-02-29")).toBe(true);
  expect(isIsoDate("2026-02-29")).toBe(false);
  expect(isIsoDate("2026-13-01")).toBe(false);
  expect(isIsoDate("2026-1-01")).toBe(false);
});

test("addDays crosses month and year ends", () => {
  expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
  expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
});

test("dateRange includes both ends", () => {
  expect(dateRange("2026-10-30", "2026-11-02")).toEqual([
    "2026-10-30",
    "2026-10-31",
    "2026-11-01",
    "2026-11-02",
  ]);
  expect(dateRange("2026-10-02", "2026-10-01")).toEqual([]);
});

test("utcDate uses UTC", () => {
  expect(utcDate(new Date("2026-10-23T23:30:00-05:00"))).toBe("2026-10-24");
});
