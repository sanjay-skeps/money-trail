import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { pdfItemsToRows, type PdfTextItem } from "./pdf-table";

// Builds a text run; width approximates 5 units per character at a 10-unit font.
const t = (text: string, x: number, y: number, page = 1): PdfTextItem => ({ text, x, y, width: text.length * 5, height: 10, page });

const header = (y: number, page = 1) => [t("Date", 50, y, page), t("Narration", 120, y, page), t("Withdrawal", 300, y, page), t("Deposit", 380, y, page), t("Balance", 460, y, page)];

describe("pdfItemsToRows", () => {
  it("rebuilds rows under the header's columns, joining wrapped lines and skipping repeated headers", () => {
    const items = [
      t("Statement of account", 50, 760), t("Account: XXXX1234", 50, 745),
      ...header(700),
      t("01/10/2026", 50, 680), t("UPI-", 120, 680), t("SWIGGY", 141, 680), t("250.00", 320, 680), t("9,750.00", 465, 680),
      t("BANGALORE", 120, 668),
      t("02/10/2026", 50, 650), t("SALARY OCT", 120, 650), t("50,000.00", 385, 650), t("59,750.00", 460, 650),
      t("Page 1 of 2", 250, 40),
      ...header(800, 2),
      t("03/10/2026", 50, 780, 2), t("ATM CASH", 120, 780, 2), t("2,000.00", 310, 780, 2), t("57,750.00", 460, 780, 2),
    ];
    assert.deepEqual(pdfItemsToRows(items), [
      ["Date", "Narration", "Withdrawal", "Deposit", "Balance"],
      ["01/10/2026", "UPI-SWIGGY BANGALORE", "250.00", "", "9,750.00"],
      ["02/10/2026", "SALARY OCT", "", "50,000.00", "59,750.00"],
      ["", "", "Page 1 of 2", "", ""],
      ["03/10/2026", "ATM CASH", "2,000.00", "", "57,750.00"],
    ]);
  });

  it("keeps items on slightly different baselines in one line", () => {
    const rows = pdfItemsToRows([...header(700), t("01/10/2026", 50, 680), t("Coffee", 120, 681.5), t("120.00", 320, 679)]);
    assert.deepEqual(rows[1], ["01/10/2026", "Coffee", "120.00", "", ""]);
  });

  it("returns plain lines when no header is recognizable", () => {
    assert.deepEqual(pdfItemsToRows([t("Hello", 50, 700), t("world", 200, 700), t("Next line", 50, 680)]), [["Hello", "world"], ["Next line"]]);
  });
});
