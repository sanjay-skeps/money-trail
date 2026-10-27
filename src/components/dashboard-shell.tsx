"use client";

import Link from "next/link";
import { useCallback, useEffect, useState, type ChangeEvent, type FormEvent } from "react";
import { usePathname, useRouter } from "next/navigation";
import { ArrowDownLeft, ArrowUpRight, Bell, CalendarClock, ChartNoAxesCombined, CircleHelp, CircleUserRound, LayoutDashboard, LogOut, Menu, Plus, Settings2, Wallet, X } from "lucide-react";
import { currencies, currencySymbol, formatMoney } from "@/lib/currency";
import { SpendingChart } from "@/components/spending-chart";
import type { SessionUser } from "@/lib/types";

type Expense = { id: string; type: "expense" | "income" | "transfer"; description: string; category: string; amount: string; transactionDate: string; merchant?: string | null; notes?: string | null; paymentMethod: string; accountId?: string | null; toAccountId?: string | null; receiptIds?: string[]; tags?: string[]; splits?: { label: string; amount: string; isMine: boolean }[] };
type Account = { id: string; name: string; type: string; kind: string; openingBalance: string; balance: number; archived: boolean };
type RecurringSchedule = { id: string; type: "expense" | "income"; description: string; category: string; amount: string; cadence: "weekly" | "monthly" | "yearly"; nextDate: string; accountId: string | null; active: boolean };
type DashboardData = {
  user: SessionUser;
  expenses: Expense[];
  monthlyTotal: number;
  previousTotal: number;
  categoryTotals: { category: string; amount: number }[];
  chartData: { day: string; amount: number }[];
  incomeTotal: number; savings: number; netWorth: number; savingsRate: number; dailyAverage: number;
  accounts: Account[];
  budgets: { id: string; name: string; amount: string; spent: number; remaining: number; utilization: number; period: string; categoryId: string | null; startDate: string; endDate: string | null; rollover: boolean; alertAt: number }[];
  alerts: { id: string; kind: string; message: string; readAt: string | null }[];
  biggestExpenses: Expense[];
  categories: { id: string; name: string; type: string; parentId: string | null; isDefault: boolean }[];
};
type AnalyticsSummary = { yearlyExpenses: number; averageDailyExpense: number; recurringMonthlyEstimate: number; merchants: { merchant: string; total: number; count: number }[]; categoryTrends: { category: string; month: string; amount: number }[] };
const categoryIcons: Record<string, string> = { Food: "◒", Transport: "↗", Shopping: "◇", Bills: "▤", Health: "+", Entertainment: "✳", Other: "·" };
const categories = ["Food", "Transport", "Shopping", "Bills", "Health", "Entertainment", "Other"];
const incomeCategories = ["Salary", "Other income"];

async function responseBody(response: Response) {
  try { return await response.json(); } catch { return {}; }
}
function parseSplits(value: FormDataEntryValue | undefined) {
  if (typeof value !== "string" || !value.trim()) return undefined;
  return value.split(",").map((part) => {
    const [label = "", amountText = ""] = part.split(":");
    const amount = Number(amountText.trim());
    return { label: label.trim(), amount, isMine: ["me", "mine", "you"].includes(label.trim().toLowerCase()) };
  });
}

export function DashboardShell() {
  const router = useRouter();
  const pathname = usePathname();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState(false);
  const [addModalOpen, setAddModalOpen] = useState(false);
  const [exportModalOpen, setExportModalOpen] = useState(false);
  const [deleteModalOpen, setDeleteModalOpen] = useState(false);
  const [exportFormat, setExportFormat] = useState<"json" | "csv">("json");
  const [notice, setNotice] = useState("");
  const [noticeError, setNoticeError] = useState(false);
  const [search, setSearch] = useState("");
  const [filterType, setFilterType] = useState("all");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [transactionRows, setTransactionRows] = useState<Expense[] | null>(null);
  const [trendPeriod, setTrendPeriod] = useState("monthly");
  const [trendData, setTrendData] = useState<{ day: string; amount: number; income: number }[]>([]);
  const [dataRevision, setDataRevision] = useState(0);
  const [analytics, setAnalytics] = useState<AnalyticsSummary | null>(null);
  const [recurringItems, setRecurringItems] = useState<RecurringSchedule[]>([]);
  const [newTransactionType, setNewTransactionType] = useState<"expense" | "income" | "transfer">("expense");
  const [newCategory, setNewCategory] = useState("Food");
  const [deleteConfirmation, setDeleteConfirmation] = useState("");
  const profileModalOpen = exportModalOpen || deleteModalOpen;
  const anyModalOpen = addModalOpen || profileModalOpen;

  const loadDashboard = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch("/api/dashboard", { cache: "no-store" });
      const result = await responseBody(response);
      if (response.status === 401) {
        router.replace("/login?error=session");
        return;
      }
      if (!response.ok) throw new Error("Could not load your dashboard. Please try again.");
      setData(result as DashboardData);
    } catch {
      setNoticeError(true);
      setNotice("Could not load your dashboard. Check your connection and try again.");
    } finally {
      setLoading(false);
    }
  }, [router]);

  useEffect(() => { void loadDashboard(); }, [loadDashboard]);
  useEffect(() => {
    if (!anyModalOpen) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setAddModalOpen(false);
        setExportModalOpen(false);
        setDeleteModalOpen(false);
        setDeleteConfirmation("");
      }
    }
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [anyModalOpen]);
  useEffect(() => {
    if (!data) return;
    let active = true;
    const params = new URLSearchParams();
    if (search.trim()) params.set("q", search.trim());
    if (filterType !== "all") params.set("type", filterType);
    if (dateFrom) params.set("from", dateFrom);
    if (dateTo) params.set("to", dateTo);
    fetch(`/api/transactions?${params}`, { cache: "no-store" }).then((response) => response.json()).then((result) => { if (active && Array.isArray(result.transactions)) setTransactionRows(result.transactions); }).catch(() => { if (active) setTransactionRows(data.expenses); });
    return () => { active = false; };
  }, [data?.user.id, dataRevision, search, filterType, dateFrom, dateTo]);
  useEffect(() => {
    if (!data) return;
    let active = true;
    fetch(`/api/analytics?period=${trendPeriod}`, { cache: "no-store" }).then((response) => response.json()).then((result) => {
      if (active && Array.isArray(result.series)) setTrendData(result.series.map((point: { date: string; expenses: number; income: number }) => ({ day: trendPeriod === "monthly" ? new Date(`${point.date}-01T12:00:00Z`).toLocaleDateString("en", { month: "short", year: "2-digit", timeZone: "UTC" }) : point.date, amount: point.expenses, income: point.income })));
      if (active) setAnalytics(result as AnalyticsSummary);
    }).catch(() => { if (active) setTrendData([]); });
    return () => { active = false; };
  }, [trendPeriod, data?.user.id]);
  useEffect(() => {
    if (!data) return;
    let active = true;
    fetch("/api/recurring", { cache: "no-store" }).then((response) => response.json()).then((result) => {
      if (active && Array.isArray(result.recurring)) setRecurringItems(result.recurring);
    }).catch(() => { if (active) setRecurringItems([]); });
    return () => { active = false; };
  }, [data?.user.id, dataRevision]);

  async function handleMutation(response: Response, successMessage: string) {
    const result = await responseBody(response);
    if (response.status === 401) {
      router.replace("/login?error=session");
      return false;
    }
    if (!response.ok) {
      setNoticeError(true);
      setNotice(result.error === "expense" ? "Check the expense details and try again." : result.error === "split" ? "Split shares must add up to the transaction amount." : result.error === "exists" ? "A category with that name already exists." : "That change could not be saved. Please try again.");
      return false;
    }
    setNoticeError(false);
    setNotice(successMessage);
    setDataRevision((value) => value + 1);
    await loadDashboard();
    return true;
  }

  async function addExpense(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    setPending(true);
    try {
      const values = Object.fromEntries(new FormData(form).entries());
      const response = await fetch("/api/transactions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...values, transactionDate: values.spentOn, spentOn: undefined, accountId: values.accountId || null, toAccountId: values.toAccountId || null, tags: String(values.tags ?? "").split(",").map((tag) => tag.trim()).filter(Boolean), splits: parseSplits(values.splitDetails) }),
      });
      if (await handleMutation(response, "Transaction saved.")) {
        form.reset();
        setNewTransactionType("expense");
        setNewCategory("Food");
        setAddModalOpen(false);
      }
    } catch {
      setNoticeError(true);
      setNotice("Could not save the transaction. Check your connection and try again.");
    } finally { setPending(false); }
  }

  async function editExpense(event: FormEvent<HTMLFormElement>, expenseId: string) {
    event.preventDefault();
    const form = event.currentTarget;
    setPending(true);
    const raw = Object.fromEntries([...new FormData(form).entries()].filter(([key]) => key !== "id"));
    const values = { ...raw, transactionDate: raw.spentOn, spentOn: undefined, accountId: raw.accountId || null, toAccountId: raw.toAccountId || null, tags: String(raw.tags ?? "").split(",").map((tag) => tag.trim()).filter(Boolean), splits: parseSplits(raw.splitDetails) ?? [] };
    try {
      await handleMutation(await fetch(`/api/transactions/${encodeURIComponent(expenseId)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(values),
      }), "Expense updated.");
    } catch {
      setNoticeError(true);
      setNotice("Could not update the expense. Check your connection and try again.");
    } finally { setPending(false); }
  }

  async function deleteExpense(expenseId: string) {
    if (!window.confirm("Delete this expense?")) return;
    setPending(true);
    try {
      await handleMutation(await fetch(`/api/transactions/${encodeURIComponent(expenseId)}`, { method: "DELETE" }), "Transaction deleted.");
    } catch {
      setNoticeError(true);
      setNotice("Could not delete the expense. Check your connection and try again.");
    } finally { setPending(false); }
  }

  async function updateCurrency(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    setPending(true);
    try {
      await handleMutation(await fetch("/api/settings/currency", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(Object.fromEntries(new FormData(form).entries())),
      }), "Currency preference updated.");
    } catch {
      setNoticeError(true);
      setNotice("Could not update currency. Check your connection and try again.");
    } finally { setPending(false); }
  }

  async function updateProfile(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    setPending(true);
    try {
      await handleMutation(await fetch("/api/profile", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(Object.fromEntries(new FormData(form).entries())),
      }), "Profile updated.");
    } catch {
      setNoticeError(true);
      setNotice("Could not update your profile. Check your connection and try again.");
    } finally { setPending(false); }
  }

  async function updatePassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const values = Object.fromEntries(new FormData(form).entries());
    if (values.newPassword !== values.confirmPassword) {
      setNoticeError(true);
      setNotice("The new password and confirmation do not match.");
      return;
    }
    setPending(true);
    try {
      const response = await fetch("/api/profile/password", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ currentPassword: values.currentPassword, newPassword: values.newPassword }),
      });
      const result = await responseBody(response);
      if (response.status === 401) {
        router.replace("/login?error=session");
        return;
      }
      if (!response.ok) {
        setNoticeError(true);
        setNotice(result.error === "current-password" ? "Your current password is incorrect." : "Use a new password with at least 10 characters.");
        return;
      }
      router.replace("/login?passwordUpdated=1");
    } catch {
      setNoticeError(true);
      setNotice("Could not update your password. Check your connection and try again.");
    } finally { setPending(false); }
  }

  async function deleteProfile() {
    if (deleteConfirmation !== "DELETE") {
      setNoticeError(true);
      setNotice("Type DELETE exactly to confirm account deletion.");
      return;
    }
    setPending(true);
    try {
      const response = await fetch("/api/profile", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirmation: deleteConfirmation }),
      });
      const result = await responseBody(response);
      if (!response.ok) {
        setNoticeError(true);
        setNotice(result.error === "session" ? "Your session expired. Please log in again." : "Account deletion failed. Your account is still active; please try again.");
        return;
      }
      router.replace("/");
    } catch {
      setNoticeError(true);
      setNotice("Could not delete your account. Check your connection and try again.");
    } finally { setPending(false); }
  }

  function closeProfileModal() {
    setExportModalOpen(false);
    setDeleteModalOpen(false);
    setDeleteConfirmation("");
  }

  function exportProfileData(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const link = document.createElement("a");
    link.href = `/api/profile/export?format=${exportFormat}`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setExportModalOpen(false);
  }

  async function submitJson(event: FormEvent<HTMLFormElement>, endpoint: string, success: string) {
    event.preventDefault(); const form = event.currentTarget; setPending(true);
    try {
      const raw = Object.fromEntries(new FormData(form).entries());
      const values = { ...raw, rollover: raw.rollover === "true", categoryId: raw.categoryId || null, parentId: raw.parentId || null, accountId: raw.accountId || null, endDate: raw.endDate || null };
      const response = await fetch(endpoint, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(values) });
      if (await handleMutation(response, success)) form.reset();
    } catch { setNoticeError(true); setNotice("Could not save that change. Check your connection and try again."); }
    finally { setPending(false); }
  }

  async function updateResource(event: FormEvent<HTMLFormElement>, endpoint: string, success: string) {
    event.preventDefault();
    const form = event.currentTarget;
    const raw = Object.fromEntries(new FormData(form).entries());
    const values = {
      ...raw,
      ...(raw.amount !== undefined ? { amount: Number(raw.amount) } : {}),
      ...(raw.openingBalance !== undefined ? { openingBalance: Number(raw.openingBalance) } : {}),
      ...(raw.categoryId !== undefined ? { categoryId: raw.categoryId || null } : {}),
      ...(raw.endDate !== undefined ? { endDate: raw.endDate || null } : {}),
      ...(raw.accountId !== undefined ? { accountId: raw.accountId || null } : {}),
      ...(raw.rollover !== undefined ? { rollover: raw.rollover === "true" } : {}),
    };
    setPending(true);
    try {
      await handleMutation(await fetch(endpoint, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(values) }), success);
    } catch { setNoticeError(true); setNotice("Could not save that change. Check your connection and try again."); }
    finally { setPending(false); }
  }

  async function patchResource(endpoint: string, values: Record<string, unknown>, success: string) {
    setPending(true);
    try {
      await handleMutation(await fetch(endpoint, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(values) }), success);
    } catch { setNoticeError(true); setNotice("Could not save that change. Check your connection and try again."); }
    finally { setPending(false); }
  }

  async function archiveResource(endpoint: string, success: string, confirmation: string) {
    if (!window.confirm(confirmation)) return;
    setPending(true);
    try {
      await handleMutation(await fetch(endpoint, { method: "DELETE" }), success);
    } catch { setNoticeError(true); setNotice("Could not complete that change. Check your connection and try again."); }
    finally { setPending(false); }
  }

  async function markAlertRead(id: string) {
    await fetch(`/api/alerts?id=${encodeURIComponent(id)}`, { method: "PATCH" });
    await loadDashboard();
  }

  async function logout() {
    setPending(true);
    try {
      const response = await fetch("/api/auth/logout", { method: "POST" });
      if (response.ok) router.replace("/");
      else throw new Error("Logout failed");
    } catch {
      setNoticeError(true);
      setNotice("Could not log out. Please try again.");
    } finally { setPending(false); }
  }

  if (loading && !data) return <main className="dashboard-loading"><span className="brand-mark">m</span><p>Finding your money trail…</p></main>;
  if (!data) return <main className="dashboard-loading"><p>{notice || "Could not load your dashboard."}</p><button className="button button-dark" onClick={() => void loadDashboard()}>Try again</button></main>;

  const { user, expenses, monthlyTotal, previousTotal, categoryTotals, chartData } = data;
  const view = pathname.split("/").filter(Boolean)[1] ?? "overview";
  const navigation = [
    { href: "/dashboard", label: "Overview", icon: LayoutDashboard, key: "overview" },
    { href: "/dashboard/transactions", label: "Transactions", icon: Wallet, key: "transactions" },
    { href: "/dashboard/accounts", label: "Accounts", icon: Wallet, key: "accounts" },
    { href: "/dashboard/budgets", label: "Budgets", icon: Settings2, key: "budgets" },
    { href: "/dashboard/recurring", label: "Recurring", icon: CalendarClock, key: "recurring" },
    { href: "/dashboard/analytics", label: "Analytics", icon: ChartNoAxesCombined, key: "analytics" },
    { href: "/dashboard/alerts", label: "Alerts", icon: Bell, key: "alerts" },
    { href: "/dashboard/settings", label: "Settings", icon: Settings2, key: "settings" },
  ];
  const pageTitle = navigation.find((item) => item.key === view)?.label ?? (view === "profile" ? "Profile" : "Overview");
  const change = previousTotal > 0 ? Math.round(((monthlyTotal - previousTotal) / previousTotal) * 100) : 0;
  const searchText = search.toLowerCase().replace(/^#/, "");
  const shownExpenses = transactionRows ?? expenses.filter((item) => (filterType === "all" || item.type === filterType) && (!dateFrom || item.transactionDate >= dateFrom) && (!dateTo || item.transactionDate <= dateTo) && `${item.description} ${item.category} ${item.merchant ?? ""} ${item.notes ?? ""} ${(item.tags ?? []).join(" ")}`.toLowerCase().includes(searchText));
  const newCategoryOptions = [...new Set([...(newTransactionType === "income" ? incomeCategories : categories), ...data.categories.filter((category) => newTransactionType === "transfer" || category.type === newTransactionType).map((category) => category.name)])];

  return <main className={`dashboard-app view-${view}${addModalOpen && view === "overview" ? " add-modal-open" : ""}${profileModalOpen && view === "profile" ? " profile-modal-open" : ""}`}>
    <aside className={`sidebar${mobileMenuOpen ? " sidebar-open" : ""}`}><Link href="/dashboard" className="brand" onClick={() => setMobileMenuOpen(false)}><span className="brand-mark">m</span> money trail</Link><div className="sidebar-label">YOUR SPACE</div><nav className="sidebar-nav" aria-label="Dashboard navigation">{navigation.map(({ href, label, icon: Icon, key }) => <Link key={key} className={`side-link${view === key ? " active" : ""}`} href={href} aria-current={view === key ? "page" : undefined} onClick={() => setMobileMenuOpen(false)}><Icon size={17} /> {label}</Link>)}</nav><div className="sidebar-bottom"><div className="sidebar-user"><Link href="/dashboard/profile" className="sidebar-profile-link" title="Open profile" aria-label={`Open profile for ${user.name}, ${user.email}`} onClick={() => setMobileMenuOpen(false)}><div className="user-avatar"><CircleUserRound size={17} /></div><div className="user-meta"><b>{user.name}</b><small>{user.email}</small></div></Link><button className="icon-button" title="Log out" aria-label="Log out" onClick={() => void logout()} disabled={pending}><LogOut size={17} /></button></div><span className="sidebar-footnote"><CircleHelp size={14} /> A little more clarity, every day.</span></div></aside>
    {addModalOpen && view === "overview" && <button type="button" className="modal-backdrop" aria-label="Close add transaction dialog" onClick={() => setAddModalOpen(false)} />}
    <section className="dashboard-main"><header className="dash-header"><button className="mobile-menu-toggle" aria-label={mobileMenuOpen ? "Close navigation" : "Open navigation"} aria-expanded={mobileMenuOpen} onClick={() => setMobileMenuOpen((open) => !open)}>{mobileMenuOpen ? <X size={19} /> : <Menu size={19} />}</button><div className="mobile-brand"><span className="brand-mark">m</span> money trail</div><div><span className="dash-date">YOUR MONEY, IN GOOD VIEW</span><h1>{view === "overview" ? `Good day, ${user.name.split(" ")[0]}` : pageTitle} <span>✳</span></h1>{view === "profile" && <p className="profile-header-copy">Manage your personal details, security, and account data.</p>}</div>{view === "overview" && <button type="button" className="button button-dark add-top" onClick={() => setAddModalOpen(true)}><Plus size={16} /> Add transaction</button>}{view === "transactions" && <a href="#add-expense" className="button button-dark add-top"><Plus size={16} /> Add transaction</a>}</header>
      {notice && <p className={noticeError ? "notice notice-error" : "notice"} role="status">{notice}</p>}
      {view === "overview" && <><div className="summary-grid"><article className="summary-card main-summary"><div className="summary-label"><span>NET WORTH</span><span className="summary-icon"><Wallet size={16} /></span></div><div className="summary-amount">{formatMoney(data.netWorth, user.currency)}</div><div className="summary-note">Across {data.accounts.length} tracked accounts</div><div className="summary-decoration">✳</div></article>
        <article className="summary-card"><div className="summary-label"><span>INCOME THIS MONTH</span><span className="summary-icon muted"><ArrowDownLeft size={16} /></span></div><div className="summary-amount small-amount">{formatMoney(data.incomeTotal, user.currency)}</div><div className="summary-note">Savings rate {data.savingsRate}%</div></article>
        <article className="summary-card"><div className="summary-label"><span>EXPENSES THIS MONTH</span><span className="summary-icon muted"><ArrowUpRight size={16} /></span></div><div className="summary-amount small-amount">{formatMoney(monthlyTotal, user.currency)}</div><div className="summary-note"><span className={change <= 0 ? "change-good" : "change-warn"}>{previousTotal ? `${change > 0 ? "+" : ""}${change}%` : "New month"}</span> vs last month · saved {formatMoney(data.savings, user.currency)}</div></article>
        <article className="summary-card"><div className="summary-label"><span>DAILY AVERAGE</span><span className="summary-icon muted"><ArrowUpRight size={16} /></span></div><div className="summary-amount small-amount">{formatMoney(data.dailyAverage, user.currency)}</div><div className="summary-note">Across the current month</div></article>
        <article className="summary-card"><div className="summary-label"><span>LAST MONTH</span><span className="summary-icon muted"><ArrowDownLeft size={16} /></span></div><div className="summary-amount small-amount">{formatMoney(previousTotal, user.currency)}</div><div className="summary-note">A look at your previous month</div></article>
        <article className="summary-card"><div className="summary-label"><span>TRANSACTIONS</span><span className="summary-icon muted"><ArrowUpRight size={16} /></span></div><div className="summary-amount small-amount">{expenses.length}<span className="count-word"> entries</span></div><div className="summary-note">Recent activity in your trail</div></article></div>
      <div className="dashboard-columns"><section className="panel chart-panel"><div className="panel-heading"><div><span className="panel-kicker">THE BIG PICTURE</span><h2>Income & spending</h2></div><select className="period-badge" aria-label="Trend period" value={trendPeriod} onChange={(event) => setTrendPeriod(event.target.value)}><option value="daily">Daily</option><option value="weekly">Weekly</option><option value="monthly">Monthly</option><option value="yearly">Yearly</option></select></div>{trendData.some((point) => point.amount > 0 || point.income > 0) ? <SpendingChart data={trendData} currency={user.currency} /> : <div className="empty-chart"><span>✳</span><b>Your money story starts here</b><small>Add a transaction to see your trends.</small></div>}<div className="chart-foot"><span><i /> Expenses · income</span><span>{formatMoney(trendData.reduce((sum, point) => sum + point.amount, 0), user.currency)} spent</span></div></section>
        <section className="panel category-panel"><div className="panel-heading"><div><span className="panel-kicker">WHERE IT GOES</span><h2>By category</h2></div><span className="soft-icon"><Settings2 size={16} /></span></div>{categoryTotals.length ? <div className="category-list">{categoryTotals.map((item, index) => <div className="category-item" key={item.category}><div className={`category-symbol category-${index % 5}`}>{categoryIcons[item.category] ?? "·"}</div><div className="category-info"><div><b>{item.category}</b><span>{formatMoney(item.amount, user.currency)}</span></div><div className="category-track"><i style={{ width: `${Math.max(4, monthlyTotal ? item.amount / monthlyTotal * 100 : 0)}%` }} /></div></div></div>)}</div> : <div className="category-empty">Your category breakdown will appear as you add expenses.</div>}
          {view === "overview" && <p className="panel-link-row"><Link href="/dashboard/analytics">Explore your analytics →</Link></p>}</section></div></>}
      {view === "settings" && <div className="settings-page">
        <section className="panel settings-panel">
          <div className="panel-heading"><div><span className="panel-kicker">DISPLAY</span><h2>Currency</h2></div><span className="soft-icon"><Settings2 size={16} /></span></div>
          <p className="muted-copy settings-description">Choose the currency used to format amounts throughout your dashboard.</p>
          <form onSubmit={updateCurrency} className="settings-currency-form">
            <label htmlFor="currency">Preferred currency</label>
            <div><select id="currency" name="currency" defaultValue={user.currency}>{currencies.map((currency) => <option key={currency} value={currency}>{currency}</option>)}</select><button className="button button-dark button-small" disabled={pending}>Save currency</button></div>
          </form>
        </section>
        <section className="panel settings-panel">
          <div className="panel-heading"><div><span className="panel-kicker">ORGANIZE</span><h2>Categories</h2></div><span className="soft-icon"><Plus size={16} /></span></div>
          <p className="muted-copy settings-description">Add categories or subcategories to organize your transactions.</p>
          <form className="settings-category-form" onSubmit={(event) => void submitJson(event, "/api/categories", "Category added.")}>
            <label>Category name<input name="name" placeholder="e.g. Groceries" maxLength={60} required /></label>
            <label>Type<select name="type"><option value="expense">Expense</option><option value="income">Income</option></select></label>
            <label>Parent category<select name="parentId" defaultValue=""><option value="">Top-level category</option>{data.categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}</select></label>
            <button className="button button-dark button-small" disabled={pending}>Add category</button>
          </form>
          <div className="managed-list">
            <h3>Your custom categories</h3>
            {data.categories.filter((category) => !category.isDefault).length ? data.categories.filter((category) => !category.isDefault).map((category) => <div className="managed-item" key={category.id}>
              <div className="managed-item-heading"><span><b>{category.name}</b><small>{category.type}{category.parentId ? ` · subcategory of ${data.categories.find((item) => item.id === category.parentId)?.name ?? "category"}` : " · top-level"}</small></span><details className="manage-details"><summary>Manage</summary><form className="manage-form" onSubmit={(event) => void updateResource(event, `/api/categories/${category.id}`, "Category updated.")}><label>Name<input name="name" defaultValue={category.name} maxLength={60} required /></label><button className="button button-dark button-small" disabled={pending}>Save</button><button type="button" className="text-danger" disabled={pending} onClick={() => void archiveResource(`/api/categories/${category.id}`, "Category removed.", `Remove ${category.name}? Transactions will keep their saved category text.`)}>Remove</button></form></details></div>
            </div>) : <p className="muted-copy">No custom categories yet.</p>}
          </div>
        </section>
      </div>}
      {view === "profile" && <div className="profile-page">
        <section className="panel profile-card">
          <div className="panel-heading"><div><span className="panel-kicker">ACCOUNT</span><h2>Personal details</h2></div><span className="soft-icon"><CircleUserRound size={16} /></span></div>
          <div className="profile-identity"><div className="profile-identity-icon"><CircleUserRound size={21} /></div><div><b>{user.name}</b><span>{user.email}</span></div></div>
          <form className="profile-form" onSubmit={(event) => void updateProfile(event)}>
            <label>Display name<input name="name" defaultValue={user.name} autoComplete="name" minLength={2} maxLength={120} required /></label>
            <button className="button button-dark button-small" disabled={pending}>Save name</button>
          </form>
        </section>
        <section className="panel profile-card">
          <div className="panel-heading"><div><span className="panel-kicker">SECURITY</span><h2>Change password</h2></div></div>
          <p className="muted-copy profile-description">Enter your current password to choose a new one. You’ll need to sign in again on all devices.</p>
          <form className="profile-form profile-password-form" onSubmit={(event) => void updatePassword(event)}>
            <label>Current password<input name="currentPassword" type="password" autoComplete="current-password" required /></label>
            <div className="profile-password-pair">
              <label>New password<input name="newPassword" type="password" autoComplete="new-password" minLength={10} maxLength={72} required /><small>Use at least 10 characters.</small></label>
              <label>Confirm new password<input name="confirmPassword" type="password" autoComplete="new-password" minLength={10} maxLength={72} required /></label>
            </div>
            <button className="button button-dark button-small" disabled={pending}>Update password</button>
          </form>
        </section>
        <section className="panel profile-card profile-records-card">
          <div className="panel-heading"><div><span className="panel-kicker">YOUR RECORDS</span><h2>Export your data</h2></div></div>
          <p className="muted-copy profile-description">Choose a format and download a copy of your Money Trail data.</p>
          <button type="button" className="button button-dark button-small profile-primary-action" onClick={() => setExportModalOpen(true)}>Export data</button>
        </section>
        <section className="panel profile-card profile-danger-card">
          <div className="panel-heading"><div><span className="panel-kicker">PERMANENT ACTION</span><h2>Delete account</h2></div></div>
          <p className="profile-delete-warning">Deleting your account permanently removes your Money Trail data and cannot be undone. Export a copy first if you want to keep your records.</p>
          <button type="button" className="button button-danger button-small" onClick={() => { setDeleteConfirmation(""); setDeleteModalOpen(true); }}>Delete account</button>
        </section>
        {profileModalOpen && <button type="button" className="modal-backdrop" aria-label="Close dialog" onClick={closeProfileModal} />}
        {exportModalOpen && <div className="profile-modal" role="dialog" aria-modal="true" aria-labelledby="export-modal-title">
          <div className="profile-modal-heading"><div><span className="panel-kicker">YOUR RECORDS</span><h2 id="export-modal-title">Export your data</h2></div><button type="button" className="icon-button" aria-label="Close export dialog" onClick={closeProfileModal}><X size={18} /></button></div>
          <p className="muted-copy">Choose a download format. JSON includes your account and finance records; CSV includes your transactions.</p>
          <form className="profile-form" onSubmit={exportProfileData}>
            <label>Export format<select value={exportFormat} onChange={(event) => setExportFormat(event.target.value as "json" | "csv")}><option value="json">Full JSON backup</option><option value="csv">Transaction CSV</option></select></label>
            <div className="profile-modal-actions"><button type="button" className="button button-light button-small" onClick={closeProfileModal}>Cancel</button><button className="button button-dark button-small">Download export</button></div>
          </form>
        </div>}
        {deleteModalOpen && <div className="profile-modal profile-delete-modal" role="dialog" aria-modal="true" aria-labelledby="delete-modal-title">
          <div className="profile-modal-heading"><div><span className="panel-kicker">PERMANENT ACTION</span><h2 id="delete-modal-title">Delete your account?</h2></div><button type="button" className="icon-button" aria-label="Close delete dialog" onClick={closeProfileModal}><X size={18} /></button></div>
          <p className="profile-delete-warning">This permanently deletes your account and data. Before continuing, export your records if you want to keep a copy.</p>
          <div className="profile-export-actions modal-export-actions"><a href="/api/profile/export?format=json">Download JSON backup</a><a href="/api/profile/export?format=csv">Download transaction CSV</a></div>
          {notice && <p className={noticeError ? "notice notice-error" : "notice"} role="status">{notice}</p>}
          <label className="profile-delete-label">Type <strong>DELETE</strong> to confirm<input value={deleteConfirmation} onChange={(event) => setDeleteConfirmation(event.target.value)} autoComplete="off" /></label>
          <div className="profile-modal-actions"><button type="button" className="button button-light button-small" onClick={closeProfileModal}>Cancel</button><button type="button" className="button button-danger button-small" disabled={pending || deleteConfirmation !== "DELETE"} onClick={() => void deleteProfile()}>Delete permanently</button></div>
        </div>}
      </div>}
      <div className="lower-columns"><section className="panel transactions-panel" id="transactions"><div className="panel-heading"><div><span className="panel-kicker">YOUR RECENT TRAIL</span><h2>Transactions</h2></div>{view === "overview" ? <Link className="transaction-count" href="/dashboard/transactions">View all →</Link> : <span className="transaction-count">{shownExpenses.length} shown</span>}</div><div className="transaction-filters"><input aria-label="Search transactions" placeholder="Search description, merchant, notes" value={search} onChange={(event) => setSearch(event.target.value)} /><input aria-label="Start date" type="date" value={dateFrom} onChange={(event) => setDateFrom(event.target.value)} /><input aria-label="End date" type="date" value={dateTo} onChange={(event) => setDateTo(event.target.value)} /><select aria-label="Filter transaction type" value={filterType} onChange={(event) => setFilterType(event.target.value)}><option value="all">All types</option><option value="expense">Expenses</option><option value="income">Income</option><option value="transfer">Transfers</option></select></div>{shownExpenses.length ? <div className="expense-table">{shownExpenses.map((expense) => <details className="expense-row" key={expense.id}><summary><div className="expense-category-icon">{categoryIcons[expense.category] ?? "·"}</div><div className="expense-title"><b>{expense.description}</b><small>{expense.type} · {expense.category} · {new Date(`${expense.transactionDate}T12:00:00`).toLocaleDateString("en", { month: "short", day: "numeric" })}</small></div><b className="expense-amount">{expense.type === "income" ? "+" : expense.type === "expense" ? "−" : "↔"}{formatMoney(expense.amount, user.currency)}</b><span className="row-chevron">⌄</span></summary><div className="expense-edit"><form onSubmit={(event) => void editExpense(event, expense.id)} className="edit-expense-form"><input type="hidden" name="accountId" value={expense.accountId ?? ""} /><label>Description<input name="description" defaultValue={expense.description} maxLength={160} required /></label><label>Amount<input name="amount" type="number" min="0.01" step="0.01" defaultValue={expense.amount} required /></label><label>Type<select name="type" defaultValue={expense.type}><option value="expense">Expense</option><option value="income">Income</option><option value="transfer">Transfer</option></select></label><label>Category<select name="category" defaultValue={expense.category} required>{[...new Set([expense.category, ...(expense.type === "income" ? incomeCategories : categories), ...data.categories.filter((item) => expense.type === "transfer" || item.type === expense.type).map((item) => item.name)])].map((name) => <option key={name} value={name}>{name}</option>)}</select></label><label>Date<input name="spentOn" type="date" defaultValue={expense.transactionDate} required /></label><label>Transfer to<select name="toAccountId" defaultValue={expense.toAccountId ?? ""}><option value="">Select account</option>{data.accounts.map((account) => <option key={account.id} value={account.id}>{account.name}</option>)}</select></label><label>Tags<input name="tags" defaultValue={expense.tags?.map((tag) => `#${tag}`).join(", ") ?? ""} placeholder="#work, #travel" /></label><label>Split shares<input name="splitDetails" defaultValue={expense.splits?.map((part) => `${part.isMine ? "Me" : part.label}:${part.amount}`).join(", ") ?? ""} placeholder="Me:500, Alex:300" /></label><label>Merchant<input name="merchant" defaultValue={expense.merchant ?? ""} maxLength={120} /></label><label>Notes<input name="notes" defaultValue={expense.notes ?? ""} maxLength={2000} /></label><label>Payment method<select name="paymentMethod" defaultValue={expense.paymentMethod}><option value="cash">Cash</option><option value="upi">UPI</option><option value="card">Card</option><option value="bank">Bank</option><option value="wallet">Wallet</option></select></label><div className="edit-actions"><button className="button button-dark button-small" disabled={pending}>Save changes</button></div></form><ReceiptUpload transactionId={expense.id} onUploaded={() => void loadDashboard()} />{expense.receiptIds?.map((receiptId) => <a className="receipt-link" key={receiptId} href={`/api/receipts/${receiptId}`} target="_blank" rel="noreferrer">View attached receipt</a>)}<button className="text-danger" onClick={() => void deleteExpense(expense.id)} disabled={pending}>Delete transaction</button></div></details>)}</div> : <div className="empty-transactions"><span>☼</span><b>No transactions found</b><small>Try a different search or add your first transaction.</small></div>}</section>
        <section className="panel add-panel" id="add-expense" role={view === "overview" ? "dialog" : undefined} aria-modal={view === "overview" && addModalOpen ? true : undefined} aria-labelledby="add-transaction-title">
          <div className="panel-heading"><div><span className="panel-kicker">KEEP YOUR TRAIL</span><h2 id="add-transaction-title">Add transaction</h2></div>{view === "overview" && <button type="button" className="icon-button modal-close" aria-label="Close dialog" onClick={() => setAddModalOpen(false)}><X size={17} /></button>}<span className="add-circle"><Plus size={17} /></span></div>
          <form onSubmit={addExpense} className="expense-form">
            <label>Type<select name="type" value={newTransactionType} onChange={(event) => { const nextType = event.target.value as "expense" | "income" | "transfer"; setNewTransactionType(nextType); setNewCategory(nextType === "income" ? "Salary" : "Food"); }}>
              <option value="expense">Expense</option><option value="income">Income</option><option value="transfer">Transfer</option>
            </select></label>
            <label>{newTransactionType === "income" ? "Income description" : newTransactionType === "transfer" ? "Transfer description" : "What was it for?"}<input name="description" placeholder={newTransactionType === "income" ? "e.g. Salary, freelance work, or refund" : newTransactionType === "transfer" ? "e.g. Move to savings" : "e.g. Lunch with friends"} maxLength={160} required /></label>
            <div className="form-two">
              <label>{newTransactionType === "income" ? "Amount received" : newTransactionType === "transfer" ? "Transfer amount" : "Amount"}<div className="amount-input"><span>{currencySymbol(user.currency)}</span><input name="amount" type="number" min="0.01" step="0.01" placeholder="0.00" required /></div></label>
              <label>Date<input name="spentOn" type="date" defaultValue={new Date().toISOString().slice(0, 10)} required /></label>
            </div>
            {newTransactionType !== "transfer" && <label>Category<select name="category" value={newCategory} onChange={(event) => setNewCategory(event.target.value)} required>{newCategoryOptions.map((name) => <option key={name} value={name}>{name}</option>)}</select></label>}
            <label>{newTransactionType === "expense" ? "Paid from" : newTransactionType === "income" ? "Deposit to" : "From account"}<select name="accountId" required={newTransactionType === "transfer"} defaultValue={data.accounts.find((account) => account.kind === "asset")?.id ?? ""}><option value="">No account</option>{data.accounts.map((account) => <option key={account.id} value={account.id}>{account.name}</option>)}</select></label>
            {newTransactionType === "transfer" && <label>To account<select name="toAccountId" required defaultValue=""><option value="">Select destination account</option>{data.accounts.map((account) => <option key={account.id} value={account.id}>{account.name}</option>)}</select></label>}
            {newTransactionType !== "transfer" && <label>{newTransactionType === "income" ? "Received via" : "Payment method"}<select name="paymentMethod"><option value="cash">Cash</option><option value="upi">UPI</option><option value="card">Card</option><option value="bank">Bank</option><option value="wallet">Wallet</option></select></label>}
            {newTransactionType !== "transfer" && <label>{newTransactionType === "income" ? "Received from" : "Merchant"}<input name="merchant" placeholder={newTransactionType === "income" ? "Optional payer or source" : "Optional"} maxLength={120} /></label>}
            <label>Notes<input name="notes" placeholder={newTransactionType === "transfer" ? "Optional transfer details" : "Optional details"} maxLength={2000} /></label>
            {newTransactionType !== "transfer" && <label>Tags<input name="tags" placeholder="#work, #travel, #family" /></label>}
            {newTransactionType === "expense" && <><label>Split shares<input name="splitDetails" placeholder="Me:500, Alex:300" /></label><small className="muted-copy">Only your share counts in reports and budgets.</small></>}
            {newTransactionType === "transfer" && <small className="muted-copy">Transfers update the two account balances and are excluded from income and spending.</small>}
            <button className="button button-dark button-full" disabled={pending}>Save {newTransactionType} <ArrowUpRight size={15} /></button>
          </form>
        </section></div>
      <div className="lower-columns finance-tools core-tools"><section className="panel"><div className="panel-heading"><div><span className="panel-kicker">YOUR MONEY</span><h2>Accounts</h2></div></div><div className="finance-list">{data.accounts.map((account) => <div className="managed-finance-row" key={account.id}><span>{account.name}<small>{account.type.replace("_", " ")}{account.archived ? " · archived" : ""}</small></span><div><b>{account.kind === "liability" ? "−" : ""}{formatMoney(account.balance, user.currency)}</b><details className="manage-details"><summary>Manage</summary><form className="manage-form" onSubmit={(event) => void updateResource(event, `/api/accounts/${account.id}`, "Account updated.")}><label>Name<input name="name" defaultValue={account.name} maxLength={100} required /></label><label>Opening balance<input name="openingBalance" type="number" step="0.01" min="0" defaultValue={account.openingBalance ?? account.balance} required /></label><button className="button button-dark button-small" disabled={pending}>Save</button><button type="button" className="button button-light button-small" disabled={pending} onClick={() => void patchResource(`/api/accounts/${account.id}`, { archived: !account.archived }, account.archived ? "Account restored." : "Account archived.")}>{account.archived ? "Restore" : "Archive"}</button></form></details></div></div>)}</div><form className="compact-form" onSubmit={(event) => void submitJson(event, "/api/accounts", "Account added.")}><input name="name" placeholder="Account name" required maxLength={100} /><select name="type"><option value="cash">Cash</option><option value="bank">Bank</option><option value="wallet">Wallet</option><option value="investment">Investment</option><option value="credit_card">Credit card</option></select><select name="kind"><option value="asset">Asset</option><option value="liability">Liability</option></select><input name="openingBalance" type="number" step="0.01" min="0" placeholder="Opening balance" required /><button className="button button-dark button-small" disabled={pending}>Add account</button></form></section>
        <section className="panel"><div className="panel-heading"><div><span className="panel-kicker">PLAN AHEAD</span><h2>Budgets</h2></div></div>{data.budgets.length ? <div className="finance-list">{data.budgets.map((budget) => <div className="budget-row managed-budget-row" key={budget.id}><span>{budget.name}<small>{budget.utilization}% used · {formatMoney(budget.remaining, user.currency)} left</small><i><em style={{ width: `${Math.min(100, budget.utilization)}%` }} /></i></span><div><b>{formatMoney(budget.amount, user.currency)}</b><details className="manage-details"><summary>Manage</summary><form className="manage-form" onSubmit={(event) => void updateResource(event, `/api/budgets/${budget.id}`, "Budget updated.")}><label>Name<input name="name" defaultValue={budget.name} maxLength={100} required /></label><label>Amount<input name="amount" type="number" step="0.01" min="0.01" defaultValue={budget.amount} required /></label><label>Category<select name="categoryId" defaultValue={budget.categoryId ?? ""}><option value="">All categories</option>{data.categories.filter((category) => category.type === "expense").map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}</select></label><label>Period<select name="period" defaultValue={budget.period}><option value="monthly">Monthly</option><option value="weekly">Weekly</option><option value="custom">Custom</option></select></label><label>Start date<input name="startDate" type="date" defaultValue={budget.startDate} required /></label><label>End date<input name="endDate" type="date" defaultValue={budget.endDate ?? ""} /></label><label>Alert threshold (%)<input name="alertAt" type="number" min="1" max="100" defaultValue={budget.alertAt} required /></label><label className="check-label"><input type="hidden" name="rollover" value="false" /><input name="rollover" type="checkbox" value="true" defaultChecked={budget.rollover} /> Rollover unused budget</label><button className="button button-dark button-small" disabled={pending}>Save budget</button><button type="button" className="text-danger" disabled={pending} onClick={() => void archiveResource(`/api/budgets/${budget.id}`, "Budget deactivated.", `Deactivate ${budget.name}?`)}>Deactivate</button></form></details></div></div>)}</div> : <p className="muted-copy">Create a budget to see spending progress here.</p>}<form className="compact-form" onSubmit={(event) => void submitJson(event, "/api/budgets", "Budget created.")}><input name="name" placeholder="Budget name" required maxLength={100} /><input name="amount" type="number" step="0.01" min="0.01" placeholder="Amount" required /><select name="categoryId" defaultValue=""><option value="">All categories</option>{data.categories.filter((category) => category.type === "expense").map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}</select><select name="period"><option value="monthly">Monthly</option><option value="weekly">Weekly</option><option value="custom">Custom</option></select><input name="startDate" type="date" defaultValue={new Date().toISOString().slice(0, 10)} required /><input name="endDate" type="date" aria-label="Custom budget end date (optional)" /><input name="alertAt" type="number" min="1" max="100" defaultValue="80" aria-label="Alert at percent" /><label className="check-label"><input name="rollover" type="checkbox" value="true" /> Rollover</label><button className="button button-dark button-small" disabled={pending}>Add budget</button></form></section>
        <section className="panel"><div className="panel-heading"><div><span className="panel-kicker">STAY AHEAD</span><h2>Alerts</h2></div></div>{data.alerts.length ? <div className="finance-list">{data.alerts.map((alert) => <div key={alert.id}><span>{alert.message}<small>{alert.kind}{alert.readAt ? " · read" : " · new"}</small></span>{!alert.readAt && <button className="text-danger" onClick={() => void markAlertRead(alert.id)}>Mark read</button>}</div>)}</div> : <p className="muted-copy">Budget and bill alerts will appear here.</p>}</section></div>
      <div className="lower-columns finance-tools scheduled-tools"><section className="panel"><div className="panel-heading"><div><span className="panel-kicker">SCHEDULED</span><h2>Recurring items</h2></div></div><p className="muted-copy">Due items wait for your review; confirming records the transaction without moving real money.</p><form className="compact-form" onSubmit={(event) => void submitJson(event, "/api/recurring", "Recurring item added.")}><input name="description" placeholder="Rent, salary, subscription…" required maxLength={160} /><select name="type"><option value="expense">Expense</option><option value="income">Income</option></select><input name="amount" type="number" step="0.01" min="0.01" placeholder="Amount" required /><select name="cadence"><option value="monthly">Monthly</option><option value="weekly">Weekly</option><option value="yearly">Yearly</option></select><input name="nextDate" type="date" required /><select name="accountId" defaultValue=""><option value="">No account</option>{data.accounts.map((account) => <option key={account.id} value={account.id}>{account.name}</option>)}</select><input name="category" defaultValue="Bills" placeholder="Category" /><button className="button button-dark button-small" disabled={pending}>Add recurring</button></form><div className="managed-list"><h3>Schedules</h3>{recurringItems.length ? recurringItems.map((schedule) => <div className="managed-item" key={schedule.id}><div className="managed-item-heading"><span><b>{schedule.description}</b><small>{schedule.type} · {schedule.cadence} · next {schedule.nextDate} · {schedule.active ? "active" : "paused"}</small></span><details className="manage-details"><summary>Manage</summary><form className="manage-form" onSubmit={(event) => void updateResource(event, `/api/recurring/${schedule.id}`, "Recurring schedule updated.")}><label>Description<input name="description" defaultValue={schedule.description} maxLength={160} required /></label><label>Amount<input name="amount" type="number" min="0.01" step="0.01" defaultValue={schedule.amount} required /></label><label>Category<input name="category" defaultValue={schedule.category} maxLength={60} required /></label><label>Cadence<select name="cadence" defaultValue={schedule.cadence}><option value="weekly">Weekly</option><option value="monthly">Monthly</option><option value="yearly">Yearly</option></select></label><label>Next date<input name="nextDate" type="date" defaultValue={schedule.nextDate} required /></label><label>Account<select name="accountId" defaultValue={schedule.accountId ?? ""}><option value="">No account</option>{data.accounts.map((account) => <option key={account.id} value={account.id}>{account.name}</option>)}</select></label><button className="button button-dark button-small" disabled={pending}>Save schedule</button><button type="button" className="button button-light button-small" disabled={pending} onClick={() => void patchResource(`/api/recurring/${schedule.id}`, { active: !schedule.active }, schedule.active ? "Recurring schedule paused." : "Recurring schedule resumed.")}>{schedule.active ? "Pause" : "Resume"}</button></form></details></div></div>) : <p className="muted-copy">No active recurring schedules.</p>}</div></section><section className="panel"><div className="panel-heading"><div><span className="panel-kicker">REVIEW BEFORE RECORDING</span><h2>Due items</h2></div></div><DueRecurring key={dataRevision} onChange={() => void loadDashboard()} currency={user.currency} /></section><section className="panel"><div className="panel-heading"><div><span className="panel-kicker">ANALYTICS</span><h2>This year and recurring</h2></div></div><div className="finance-list"><div><span>Year to date spending<small>Average {formatMoney(analytics?.averageDailyExpense ?? 0, user.currency)} per day</small></span><b>{formatMoney(analytics?.yearlyExpenses ?? 0, user.currency)}</b></div><div><span>Monthly recurring estimate<small>Active scheduled expenses</small></span><b>{formatMoney(analytics?.recurringMonthlyEstimate ?? 0, user.currency)}</b></div></div><div className="panel-heading analytics-heading"><div><span className="panel-kicker">MERCHANTS</span><h2>Where you spend most</h2></div></div><div className="finance-list">{analytics?.merchants.slice(0, 5).map((merchant) => <div key={merchant.merchant}><span>{merchant.merchant}<small>{merchant.count} transactions</small></span><b>{formatMoney(merchant.total, user.currency)}</b></div>)}</div></section><section className="panel"><div className="panel-heading"><div><span className="panel-kicker">TOP SPEND</span><h2>Biggest expenses</h2></div></div><div className="finance-list">{data.biggestExpenses.map((item) => <div key={item.id}><span>{item.description}<small>{item.category}</small></span><b>{formatMoney(item.amount, user.currency)}</b></div>)}</div></section></div>
      <footer className="dashboard-footer"><span>money trail <i>✳</i></span><span>Your finances, for your eyes only.</span></footer>
    </section>
  </main>;
}

function DueRecurring({ onChange, currency }: { onChange: () => void; currency: string }) {
  const [items, setItems] = useState<{ occurrence: { id: string; dueDate: string }; schedule: { description: string; amount: string; type: string } }[]>([]);
  useEffect(() => { fetch("/api/recurring").then((response) => response.json()).then((data) => setItems(data.due ?? [])).catch(() => setItems([])); }, []);
  async function decide(id: string, action: "confirm" | "skip") { await fetch(`/api/recurring/occurrences/${id}?action=${action}`, { method: "POST" }); setItems((current) => current.filter((item) => item.occurrence.id !== id)); onChange(); }
  return items.length ? <div className="finance-list">{items.map(({ occurrence, schedule }) => <div key={occurrence.id}><span>{schedule.description}<small>Due {occurrence.dueDate} · {schedule.type}</small></span><b>{formatMoney(schedule.amount, currency)}</b><button className="currency-save" onClick={() => void decide(occurrence.id, "confirm")}>Add</button><button className="text-danger" onClick={() => void decide(occurrence.id, "skip")}>Skip</button></div>)}</div> : <p className="muted-copy">No recurring items need review.</p>;
}

function ReceiptUpload({ transactionId, onUploaded }: { transactionId: string; onUploaded: () => void }) {
  const [message, setMessage] = useState("");
  async function upload(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]; if (!file) return;
    const body = new FormData(); body.set("file", file); body.set("transactionId", transactionId);
    const response = await fetch("/api/receipts", { method: "POST", body });
    setMessage(response.ok ? "Receipt attached." : "Upload failed (max 5 MB; JPG, PNG, WebP, or PDF). ");
    if (response.ok) onUploaded();
    event.target.value = "";
  }
  return <div className="receipt-upload-wrap"><label className="receipt-upload">Attach receipt <input type="file" accept="image/jpeg,image/png,image/webp,application/pdf" onChange={(event) => void upload(event)} /></label>{message && <small className="muted-copy">{message}</small>}</div>;
}
