/** "$12,000" when whole dollars, "$1,250.50" otherwise. */
export const dollars = (cents: number) =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: cents % 100 ? 2 : 0,
    maximumFractionDigits: 2,
  }).format(cents / 100);

/** Signed dollar change: "+$12,000", "−$350". */
export const change = (cents: number) =>
  cents === 0 ? "$0" : `${cents > 0 ? "+" : "−"}${dollars(Math.abs(cents))}`;

/** Percent change; when there is none (prior total zero or negative), say why. */
export const percent = (value: number | null, priorCents = 0) =>
  value === null
    ? priorCents === 0 ? "new this month" : "no % change: September was negative"
    : `${new Intl.NumberFormat("en-US", {
        maximumFractionDigits: 0,
        signDisplay: "exceptZero",
      }).format(value)}%`;

export const shortDate = (isoDate: string) =>
  new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "UTC" }).format(
    new Date(`${isoDate}T00:00:00.000Z`),
  );

/** Days between two ISO dates. */
export const daysApart = (a: string, b: string) =>
  Math.round(Math.abs(Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) / 86_400_000);
