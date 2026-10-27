const isoDate = /^\d{4}-\d{2}-\d{2}$/;
const dayMs = 24 * 60 * 60 * 1000;

/** Returns the UTC calendar date of an instant as `YYYY-MM-DD`. */
export const utcDate = (instant: Date): string => instant.toISOString().slice(0, 10);

/** Returns whether the text is a valid `YYYY-MM-DD` calendar date. */
export const isIsoDate = (text: string): boolean => {
  const ms = Date.parse(`${text}T00:00:00.000Z`);

  // Date.parse rolls invalid days such as February 30 into the next month, so compare the round trip.
  return isoDate.test(text) && !Number.isNaN(ms) && utcDate(new Date(ms)) === text;
};

/** Adds whole days to a `YYYY-MM-DD` date. */
export const addDays = (date: string, days: number): string =>
  utcDate(new Date(Date.parse(`${date}T00:00:00.000Z`) + days * dayMs));

/** Lists every date from `start` to `end`, both included. */
export const dateRange = (start: string, end: string): string[] => {
  const dates: string[] = [];

  for (let date = start; date <= end; date = addDays(date, 1)) {
    dates.push(date);
  }

  return dates;
};
