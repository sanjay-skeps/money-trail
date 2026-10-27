// Pure ledger helpers shared by server code; kept free of server-only imports so they can be unit tested.

export type Cadence = "weekly" | "monthly" | "yearly";

function daysInMonth(year: number, monthIndex: number) {
  return new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate();
}

/**
 * Next due date for a recurring schedule. Monthly and yearly cadences keep the schedule's
 * anchor day (e.g. the 31st) and clamp it to the target month's length, so a bill due on
 * Jan 31 is next due Feb 28 and then Mar 31 instead of drifting.
 */
export function nextDueDate(dueDate: string, cadence: Cadence, anchorDay?: number | null) {
  const [year, month, day] = dueDate.split("-").map(Number);
  if (cadence === "weekly") return new Date(Date.UTC(year, month - 1, day + 7)).toISOString().slice(0, 10);
  const anchor = anchorDay ?? day;
  const targetYear = cadence === "yearly" ? year + 1 : year + Math.floor(month / 12);
  const targetMonth = cadence === "yearly" ? month - 1 : month % 12;
  const targetDay = Math.min(anchor, daysInMonth(targetYear, targetMonth));
  return new Date(Date.UTC(targetYear, targetMonth, targetDay)).toISOString().slice(0, 10);
}

export type BalanceMovement = { accountId: string | null; toAccountId: string | null; type: string; amount: string | number };

/**
 * Account balance from its opening balance and ledger movements. For liabilities the balance
 * is the amount owed: spending and transfers out (cash advances) raise it, while income
 * (refunds) and transfers in (payments) lower it.
 */
export function accountBalance(account: { id: string; kind: string; openingBalance: string | number }, movements: BalanceMovement[]) {
  const sign = account.kind === "liability" ? -1 : 1;
  let balance = Number(account.openingBalance);
  for (const row of movements) {
    const amount = Number(row.amount);
    if (row.accountId === account.id) {
      if (row.type === "income") balance += sign * amount;
      else if (row.type === "expense" || row.type === "transfer") balance -= sign * amount;
    }
    if (row.toAccountId === account.id && row.type === "transfer") balance += sign * amount;
  }
  return balance;
}

export function splitsMatchAmount(splits: { amount: string | number }[], amount: number) {
  const total = splits.reduce((sum, part) => sum + Number(part.amount), 0);
  return Math.abs(total - amount) <= 0.01;
}

/**
 * First day of the month before the one starting at `monthStart` (YYYY-MM-01). Built from the
 * month start rather than today, because subtracting a month from e.g. Mar 31 overflows back into March.
 */
export function previousMonthStart(monthStart: string) {
  const [year, month] = monthStart.split("-").map(Number);
  return new Date(Date.UTC(year, month - 2, 1)).toISOString().slice(0, 10);
}
