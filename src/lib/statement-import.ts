// Turns parsed bank/card statement rows into transactions. Pure so the browser can preview and tests can cover it.

export type DateFormat = "dmy" | "mdy";
export type AmountMode = "negative-is-expense" | "positive-is-expense" | "debit-credit";
export type ColumnMapping = { date: number; description: number; merchant: number | null; amount: number | null; debit: number | null; credit: number | null };
export type StatementRow = { row: number; date: string; description: string; merchant: string | null; amount: number; type: "expense" | "income" };
export type StatementError = { row: number; reason: "date" | "description" | "amount" };
export type CategoryRule = { pattern: string; type: string; category: string };

const months = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

function isoDate(year: number, month: number, day: number) {
  if (year < 100) year += year < 70 ? 2000 : 1900;
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  return date.toISOString().slice(0, 10);
}

function monthNumber(name: string) {
  const index = months.indexOf(name.slice(0, 3).toLowerCase());
  return index < 0 ? null : index + 1;
}

/** Parses statement dates such as 2026-01-05, 05/01/2026, 05-Jan-26 or Jan 5, 2026; a trailing time is ignored. */
export function parseStatementDate(value: string, format: DateFormat): string | null {
  const text = value.trim();
  let match = text.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/);
  if (match) return isoDate(Number(match[1]), Number(match[2]), Number(match[3]));
  match = text.match(/^(\d{1,2})[-/. ]([A-Za-z]{3,9})[-/. ,]+(\d{2,4})/);
  if (match) { const month = monthNumber(match[2]); return month ? isoDate(Number(match[3]), month, Number(match[1])) : null; }
  match = text.match(/^([A-Za-z]{3,9})[-/. ]+(\d{1,2}),?[-/. ]+(\d{2,4})/);
  if (match) { const month = monthNumber(match[1]); return month ? isoDate(Number(match[3]), month, Number(match[2])) : null; }
  match = text.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})/);
  if (!match) return null;
  const [first, second, year] = [Number(match[1]), Number(match[2]), Number(match[3])];
  return format === "dmy" ? isoDate(year, second, first) : isoDate(year, first, second);
}

/** Picks day-first or month-first from values that are unambiguous (a part above 12); day-first otherwise. */
export function detectDateFormat(values: string[]): DateFormat {
  for (const value of values) {
    const match = value.trim().match(/^(\d{1,2})[-/.](\d{1,2})[-/.]\d{2,4}/);
    if (!match) continue;
    if (Number(match[1]) > 12) return "dmy";
    if (Number(match[2]) > 12) return "mdy";
  }
  return "dmy";
}

/** Parses amounts like "₹1,23,456.78", "-50", "(50.00)", "50.00 Dr" or "12,50"; negative means money out. */
export function parseStatementAmount(value: string): number | null {
  let text = value.trim();
  if (!text) return null;
  let negative = false;
  if (/^\(.*\)$/.test(text)) { negative = true; text = text.slice(1, -1); }
  const marker = text.match(/(cr|dr)\.?\s*$/i);
  if (marker) { if (marker[1].toLowerCase() === "dr") negative = !negative; text = text.slice(0, marker.index); }
  if (text.includes("-")) negative = !negative;
  text = text.replace(/[^\d.,]/g, "");
  // A final comma followed by one or two digits is a decimal comma ("12,50"); otherwise commas group thousands.
  text = /,\d{1,2}$/.test(text) ? text.replace(/\./g, "").replace(",", ".") : text.replace(/,/g, "");
  if (!/^\d*\.?\d+$/.test(text)) return null;
  const amount = Math.round(Number(text) * 100) / 100;
  return negative ? -amount : amount;
}

/** The header is the first row with as many cells as most rows, which skips bank preamble lines. */
export function findHeaderRow(rows: string[][]) {
  const counts = new Map<number, number>();
  for (const row of rows) counts.set(row.length, (counts.get(row.length) ?? 0) + 1);
  const width = [...counts.entries()].reduce((best, entry) => (entry[1] > best[1] || (entry[1] === best[1] && entry[0] > best[0]) ? entry : best), [0, 0])[0];
  const index = rows.findIndex((row) => row.length === width && row.filter(Boolean).length >= 2);
  return Math.max(0, index);
}

/** Guesses columns from common bank header names. */
export function guessMapping(header: string[]): ColumnMapping {
  const find = (pattern: RegExp, exclude?: RegExp) => {
    const index = header.findIndex((name) => pattern.test(name) && !exclude?.test(name));
    return index < 0 ? null : index;
  };
  const date = find(/date/i, /value/i) ?? find(/date/i) ?? 0;
  const description = find(/description|narration|details|particulars|remarks|memo/i) ?? find(/payee|merchant|name/i) ?? 1;
  const merchant = find(/merchant|payee/i);
  return {
    date, description, merchant: merchant === description ? null : merchant,
    amount: find(/amount|amt/i, /balance/i),
    debit: find(/debit|withdrawal|\bdr\b|money out|paid out/i),
    credit: find(/credit|deposit|\bcr\b|money in|paid in/i),
  };
}

export function normalizeStatement(rows: string[][], mapping: ColumnMapping, format: DateFormat, mode: AmountMode) {
  const parsed: StatementRow[] = [], errors: StatementError[] = [];
  rows.forEach((cells, index) => {
    const row = index + 1;
    const cell = (column: number | null) => (column === null ? "" : (cells[column] ?? "").trim());
    const date = parseStatementDate(cell(mapping.date), format);
    if (!date) return errors.push({ row, reason: "date" });
    const merchant = cell(mapping.merchant).slice(0, 120) || null;
    const description = (cell(mapping.description) || merchant || "").replace(/\s+/g, " ").slice(0, 160);
    if (!description) return errors.push({ row, reason: "description" });
    let signed: number | null;
    if (mode === "debit-credit") {
      const debit = Math.abs(parseStatementAmount(cell(mapping.debit)) ?? 0), credit = Math.abs(parseStatementAmount(cell(mapping.credit)) ?? 0);
      signed = debit ? -debit : credit || null;
    } else {
      const amount = parseStatementAmount(cell(mapping.amount));
      signed = amount && (mode === "negative-is-expense" ? amount : -amount);
    }
    if (!signed || Math.abs(signed) > 999999999999) return errors.push({ row, reason: "amount" });
    parsed.push({ row, date, description, merchant, amount: Math.abs(signed), type: signed < 0 ? "expense" : "income" });
  });
  return { rows: parsed, errors };
}

/** The longest matching pattern wins, so "amazon prime" beats "amazon"; earlier rules win ties. */
export function matchCategoryRule(rules: CategoryRule[], item: { description: string; merchant?: string | null; type: string }) {
  const text = `${item.description} ${item.merchant ?? ""}`.toLowerCase();
  let best: CategoryRule | null = null;
  for (const rule of rules) {
    if (rule.type !== item.type || !text.includes(rule.pattern.toLowerCase())) continue;
    if (!best || rule.pattern.length > best.pattern.length) best = rule;
  }
  return best?.category ?? null;
}

export function duplicateKey(item: { date: string; type: string; amount: string | number; description: string }) {
  return `${item.date}|${item.type}|${Number(item.amount).toFixed(2)}|${item.description.trim().toLowerCase().replace(/\s+/g, " ")}`;
}

/** Flags incoming rows already in the ledger. Counts matter: two identical coffees in the file vs one saved flags only one. */
export function flagDuplicates(incoming: string[], existing: string[]) {
  const remaining = new Map<string, number>();
  for (const key of existing) remaining.set(key, (remaining.get(key) ?? 0) + 1);
  return incoming.map((key) => {
    const left = remaining.get(key) ?? 0;
    if (left) remaining.set(key, left - 1);
    return left > 0;
  });
}
