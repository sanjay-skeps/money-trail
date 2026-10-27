// Rebuilds statement rows from positioned PDF text. Pure so it can be unit tested without pdf.js.
import { parseStatementDate } from "@/lib/statement-import";

/** One run of text from pdf.js; x/y are the baseline origin in PDF units (y grows upward). */
export type PdfTextItem = { text: string; x: number; y: number; width: number; height: number; page: number };
type Cell = { text: string; x0: number; x1: number };
type Line = { page: number; y: number; height: number; cells: Cell[] };

const headerPattern = /amount|debit|credit|withdrawal|deposit|balance/i;

function toLines(items: PdfTextItem[]): Line[] {
  const sorted = items.filter((item) => item.text.trim()).sort((a, b) => a.page - b.page || b.y - a.y || a.x - b.x);
  const groups: { page: number; y: number; height: number; items: PdfTextItem[] }[] = [];
  for (const item of sorted) {
    const last = groups[groups.length - 1];
    const height = item.height || 10;
    if (last && last.page === item.page && Math.abs(last.y - item.y) <= Math.max(2, Math.min(height, last.height) * 0.5)) last.items.push(item);
    else groups.push({ page: item.page, y: item.y, height, items: [item] });
  }
  return groups.map((group) => {
    const cells: Cell[] = [];
    for (const item of [...group.items].sort((a, b) => a.x - b.x)) {
      const last = cells[cells.length - 1], gap = last ? item.x - last.x1 : Infinity;
      // Gaps under about half a character are word spacing; wider gaps separate columns, which can sit close in dense tables.
      if (last && gap < group.height * 0.5) {
        last.text += (gap > group.height * 0.1 && !last.text.endsWith(" ") ? " " : "") + item.text;
        last.x1 = Math.max(last.x1, item.x + item.width);
      } else cells.push({ text: item.text, x0: item.x, x1: item.x + item.width });
    }
    for (const cell of cells) cell.text = cell.text.replace(/\s+/g, " ").trim();
    return { page: group.page, y: group.y, height: group.height, cells };
  });
}

function columnFor(cell: Cell, columns: Cell[]) {
  let best = 0, bestScore = -Infinity;
  columns.forEach((column, index) => {
    const overlap = Math.min(cell.x1, column.x1) - Math.max(cell.x0, column.x0);
    // Prefer real overlap; otherwise the nearest column centre.
    const score = overlap > 0 ? overlap : -Math.abs((cell.x0 + cell.x1) / 2 - (column.x0 + column.x1) / 2) - 1e6;
    if (score > bestScore) { best = index; bestScore = score; }
  });
  return best;
}

/**
 * Turns PDF text into a grid whose first row is the statement's column header. Columns come from the
 * header's positions, wrapped description lines join the row above, and headers repeated on later pages
 * are dropped. Without a recognizable header, each line's cells are returned as-is.
 */
export function pdfItemsToRows(items: PdfTextItem[]): string[][] {
  const lines = toLines(items);
  const headerIndex = lines.findIndex((line) => line.cells.length >= 3 && line.cells.some((cell) => /date/i.test(cell.text)) && line.cells.some((cell) => headerPattern.test(cell.text)));
  if (headerIndex < 0) return lines.map((line) => line.cells.map((cell) => cell.text));
  const columns = lines[headerIndex].cells;
  const header = columns.map((cell) => cell.text);
  const headerKey = header.join("|").toLowerCase();
  const dateColumn = Math.max(0, header.findIndex((name) => /date/i.test(name) && !/value/i.test(name)));
  const rows: string[][] = [header];
  let previous: Line | null = null;
  for (const line of lines.slice(headerIndex + 1)) {
    if (line.cells.map((cell) => cell.text).join("|").toLowerCase() === headerKey) { previous = null; continue; }
    const row = header.map(() => "");
    for (const cell of line.cells) {
      const index = columnFor(cell, columns);
      row[index] = row[index] ? `${row[index]} ${cell.text}` : cell.text;
    }
    const hasDate = !!parseStatementDate(row[dateColumn], "dmy") || !!parseStatementDate(row[dateColumn], "mdy");
    const wrapsPrevious = previous && previous.page === line.page && previous.y - line.y <= previous.height * 2.2;
    if (!hasDate && wrapsPrevious && rows.length > 1) {
      const target = rows[rows.length - 1];
      row.forEach((text, index) => { if (text) target[index] = target[index] ? `${target[index]} ${text}` : text; });
    } else rows.push(row);
    previous = line;
  }
  return rows;
}
