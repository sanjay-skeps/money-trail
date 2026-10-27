import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { accountBalance, nextDueDate, previousMonthStart, splitsMatchAmount } from "./finance";

describe("nextDueDate", () => {
  it("adds seven days for weekly schedules", () => {
    assert.equal(nextDueDate("2027-12-28", "weekly"), "2028-01-04");
  });
  it("clamps month-end anchors without drifting", () => {
    assert.equal(nextDueDate("2027-01-31", "monthly", 31), "2027-02-28");
    assert.equal(nextDueDate("2027-02-28", "monthly", 31), "2027-03-31");
    assert.equal(nextDueDate("2027-03-31", "monthly", 31), "2027-04-30");
    assert.equal(nextDueDate("2028-01-30", "monthly", 30), "2028-02-29");
  });
  it("rolls monthly schedules over the year boundary", () => {
    assert.equal(nextDueDate("2027-12-15", "monthly"), "2028-01-15");
  });
  it("uses the due date's day when no anchor is stored", () => {
    assert.equal(nextDueDate("2027-05-10", "monthly", null), "2027-06-10");
  });
  it("handles leap days for yearly schedules", () => {
    assert.equal(nextDueDate("2028-02-29", "yearly", 29), "2029-02-28");
    assert.equal(nextDueDate("2029-02-28", "yearly", 29), "2030-02-28");
    assert.equal(nextDueDate("2031-02-28", "yearly", 29), "2032-02-29");
  });
});

describe("accountBalance", () => {
  const bank = { id: "bank", kind: "asset", openingBalance: "1000.00" };
  const card = { id: "card", kind: "liability", openingBalance: "200.00" };
  const movements = [
    { accountId: "bank", toAccountId: null, type: "income", amount: "500.00" },
    { accountId: "bank", toAccountId: null, type: "expense", amount: "100.00" },
    { accountId: "card", toAccountId: null, type: "expense", amount: "300.00" },
    { accountId: "card", toAccountId: null, type: "income", amount: "50.00" },
    { accountId: "bank", toAccountId: "card", type: "transfer", amount: "250.00" },
    { accountId: "card", toAccountId: "bank", type: "transfer", amount: "40.00" },
  ];
  it("tracks asset balances", () => {
    assert.equal(accountBalance(bank, movements), 1000 + 500 - 100 - 250 + 40);
  });
  it("tracks the amount owed on liabilities, including refunds and cash advances", () => {
    assert.equal(accountBalance(card, movements), 200 + 300 - 50 - 250 + 40);
  });
});

describe("splitsMatchAmount", () => {
  it("accepts splits within a cent of the amount", () => {
    assert.equal(splitsMatchAmount([{ amount: "500.00" }, { amount: 300 }], 800), true);
    assert.equal(splitsMatchAmount([{ amount: "500.00" }, { amount: "300.00" }], 900), false);
  });
});

describe("previousMonthStart", () => {
  it("returns the first day of the prior month, across year boundaries", () => {
    assert.equal(previousMonthStart("2026-03-01"), "2026-02-01");
    assert.equal(previousMonthStart("2026-10-01"), "2026-09-01");
    assert.equal(previousMonthStart("2026-01-01"), "2025-12-01");
  });
});
