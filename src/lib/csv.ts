// CSV reading and writing shared by statement import (browser) and transaction export (server).

function detectDelimiter(text: string) {
  const sample = text.split(/\r?\n/).filter((line) => line.trim()).slice(0, 10).join("\n").replace(/"[^"]*"/g, "");
  const counts = [",", ";", "\t"].map((delimiter) => ({ delimiter, count: sample.split(delimiter).length - 1 }));
  return counts.reduce((best, item) => (item.count > best.count ? item : best)).delimiter;
}

/** Parses CSV text (comma, semicolon or tab separated) into trimmed cells, dropping blank lines. */
export function parseCsv(text: string): string[][] {
  const source = text.replace(/^﻿/, "");
  const delimiter = detectDelimiter(source);
  const rows: string[][] = [];
  let row: string[] = [], cell = "", quoted = false;
  const endRow = () => {
    row.push(cell.trim());
    if (row.some((value) => value)) rows.push(row);
    row = []; cell = "";
  };
  for (let index = 0; index < source.length; index++) {
    const char = source[index];
    if (quoted) {
      if (char !== '"') cell += char;
      else if (source[index + 1] === '"') { cell += '"'; index++; }
      else quoted = false;
    } else if (char === '"' && !cell.trim()) { cell = ""; quoted = true; }
    else if (char === delimiter) { row.push(cell.trim()); cell = ""; }
    else if (char === "\n" || char === "\r") {
      if (char === "\r" && source[index + 1] === "\n") index++;
      endRow();
    } else cell += char;
  }
  if (cell || row.length) endRow();
  return rows;
}

/** Quotes every cell and neutralizes leading formula characters so spreadsheets don't execute them. */
export function toCsv(rows: (string | number)[][]) {
  const escapeCell = (value: string) => {
    const safe = /^[\s]*[=+\-@]/.test(value) ? `'${value}` : value;
    return `"${safe.replace(/"/g, '""')}"`;
  };
  return rows.map((row) => row.map((value) => escapeCell(String(value))).join(",")).join("\r\n");
}
