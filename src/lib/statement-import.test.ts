import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseCsv, toCsv } from "./csv";
import { detectDateFormat, duplicateKey, findHeaderRow, flagDuplicates, guessMapping, matchCategoryRule, normalizeStatement, parseStatementAmount, parseStatementDate } from "./statement-import";

describe("parseCsv", () => {
  it("handles quotes, escaped quotes, CRLF, BOM and blank lines", () => {
    assert.deepEqual(parseCsv('﻿Date,Description,Amount\r\n2026-01-05,"Swiggy, Bangalore",-250\r\n\r\n2026-01-06,"He said ""hi""",100\n'), [
      ["Date", "Description", "Amount"],
      ["2026-01-05", "Swiggy, Bangalore", "-250"],
      ["2026-01-06", 'He said "hi"', "100"],
    ]);
  });
  it("detects semicolon and tab delimiters", () => {
    assert.deepEqual(parseCsv("a;b;c\n1;2,5;3"), [["a", "b", "c"], ["1", "2,5", "3"]]);
    assert.deepEqual(parseCsv("a\tb\n1\t2"), [["a", "b"], ["1", "2"]]);
  });
  it("round-trips through toCsv and guards formula cells", () => {
    const csv = toCsv([["Name", "Note"], ["=SUM(A1)", 'say "x"']]);
    assert.equal(csv, '"Name","Note"\r\n"\'=SUM(A1)","say ""x"""');
    assert.deepEqual(parseCsv(csv), [["Name", "Note"], ["'=SUM(A1)", 'say "x"']]);
  });
});

describe("parseStatementDate", () => {
  it("reads ISO, numeric, and month-name dates", () => {
    assert.equal(parseStatementDate("2026-01-05", "mdy"), "2026-01-05");
    assert.equal(parseStatementDate("05/01/2026", "dmy"), "2026-01-05");
    assert.equal(parseStatementDate("05/01/2026", "mdy"), "2026-05-01");
    assert.equal(parseStatementDate("5.1.26", "dmy"), "2026-01-05");
    assert.equal(parseStatementDate("05-Jan-2026", "mdy"), "2026-01-05");
    assert.equal(parseStatementDate("05 January 26", "dmy"), "2026-01-05");
    assert.equal(parseStatementDate("Jan 5, 2026", "dmy"), "2026-01-05");
    assert.equal(parseStatementDate("2026-01-05 14:32:00", "dmy"), "2026-01-05");
  });
  it("rejects impossible or unknown dates", () => {
    assert.equal(parseStatementDate("31/02/2026", "dmy"), null);
    assert.equal(parseStatementDate("Opening balance", "dmy"), null);
  });
  it("detects day-first or month-first from unambiguous values", () => {
    assert.equal(detectDateFormat(["01/02/2026", "25/02/2026"]), "dmy");
    assert.equal(detectDateFormat(["01/02/2026", "02/25/2026"]), "mdy");
    assert.equal(detectDateFormat(["01/02/2026"]), "dmy");
  });
});

describe("parseStatementAmount", () => {
  it("reads symbols, separators, signs, and Dr/Cr markers", () => {
    assert.equal(parseStatementAmount("₹1,23,456.78"), 123456.78);
    assert.equal(parseStatementAmount("-$50.00"), -50);
    assert.equal(parseStatementAmount("(50.00)"), -50);
    assert.equal(parseStatementAmount("50.00 Dr"), -50);
    assert.equal(parseStatementAmount("50.00 CR"), 50);
    assert.equal(parseStatementAmount("1.234,56"), 1234.56);
    assert.equal(parseStatementAmount("12,50"), 12.5);
    assert.equal(parseStatementAmount("1,234"), 1234);
  });
  it("returns null for empty or non-numeric cells", () => {
    assert.equal(parseStatementAmount(""), null);
    assert.equal(parseStatementAmount("n/a"), null);
  });
});

describe("statement mapping", () => {
  it("skips preamble lines to find the header", () => {
    const rows = [["Account statement"], ["Name: A"], ["Date", "Narration", "Debit", "Credit", "Balance"], ["01/01/26", "x", "1", "", "9"], ["02/01/26", "y", "", "2", "11"]];
    assert.equal(findHeaderRow(rows), 2);
  });
  it("guesses common bank columns", () => {
    assert.deepEqual(guessMapping(["Txn Date", "Value Date", "Narration", "Withdrawal Amt.", "Deposit Amt.", "Closing Balance"]), { date: 0, description: 2, merchant: null, amount: 3, debit: 3, credit: 4 });
    assert.deepEqual(guessMapping(["Date", "Payee", "Amount"]), { date: 0, description: 1, merchant: null, amount: 2, debit: null, credit: null });
  });
  it("normalizes signed and debit/credit statements and reports bad rows", () => {
    const signed = normalizeStatement([["05/01/2026", "Swiggy", "-250"], ["06/01/2026", "Salary", "50000"], ["bad", "x", "1"], ["07/01/2026", "", "1"], ["08/01/2026", "Zero", "0"]], { date: 0, description: 1, merchant: null, amount: 2, debit: null, credit: null }, "dmy", "negative-is-expense");
    assert.deepEqual(signed.rows, [
      { row: 1, date: "2026-01-05", description: "Swiggy", merchant: null, amount: 250, type: "expense" },
      { row: 2, date: "2026-01-06", description: "Salary", merchant: null, amount: 50000, type: "income" },
    ]);
    assert.deepEqual(signed.errors, [{ row: 3, reason: "date" }, { row: 4, reason: "description" }, { row: 5, reason: "amount" }]);
    const card = normalizeStatement([["2026-01-05", "Uber", "320"]], { date: 0, description: 1, merchant: null, amount: 2, debit: null, credit: null }, "dmy", "positive-is-expense");
    assert.equal(card.rows[0].type, "expense");
    const bank = normalizeStatement([["2026-01-05", "ATM", "1,000.00", ""], ["2026-01-06", "Refund", "", "99"]], { date: 0, description: 1, merchant: null, amount: null, debit: 2, credit: 3 }, "dmy", "debit-credit");
    assert.deepEqual(bank.rows.map((row) => [row.type, row.amount]), [["expense", 1000], ["income", 99]]);
  });
});

describe("category rules and duplicates", () => {
  const rules = [{ pattern: "amazon", type: "expense", category: "Shopping" }, { pattern: "Amazon Prime", type: "expense", category: "Entertainment" }, { pattern: "amazon", type: "income", category: "Other income" }];
  it("prefers the longest matching pattern of the same type, case-insensitively", () => {
    assert.equal(matchCategoryRule(rules, { description: "AMAZON PRIME VIDEO", type: "expense" }), "Entertainment");
    assert.equal(matchCategoryRule(rules, { description: "Order", merchant: "Amazon.in", type: "expense" }), "Shopping");
    assert.equal(matchCategoryRule(rules, { description: "Amazon refund", type: "income" }), "Other income");
    assert.equal(matchCategoryRule(rules, { description: "Swiggy", type: "expense" }), null);
  });
  it("flags only as many duplicates as already exist", () => {
    const coffee = duplicateKey({ date: "2026-01-05", type: "expense", amount: 120, description: "Coffee  Day" });
    assert.equal(coffee, duplicateKey({ date: "2026-01-05", type: "expense", amount: "120.00", description: "coffee day" }));
    assert.deepEqual(flagDuplicates([coffee, coffee, "other"], [coffee]), [true, false, false]);
  });
});
