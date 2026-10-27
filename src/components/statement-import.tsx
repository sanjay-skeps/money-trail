"use client";

import { useState, type ChangeEvent } from "react";
import { useRouter } from "next/navigation";
import { X } from "lucide-react";
import { formatMoney } from "@/lib/currency";
import { parseCsv } from "@/lib/csv";
import { pdfItemsToRows } from "@/lib/pdf-table";
import { detectDateFormat, findHeaderRow, guessMapping, normalizeStatement, type AmountMode, type ColumnMapping, type DateFormat, type StatementError, type StatementRow } from "@/lib/statement-import";

type PreviewRow = StatementRow & { category: string; duplicate: boolean; include: boolean };
type Props = { accounts: { id: string; name: string }[]; categories: { name: string; type: string }[]; currency: string; onImported: (count: number) => void; onClose: () => void };

const reasons: Record<StatementError["reason"], string> = { date: "unreadable date", description: "no description", amount: "no amount" };

export function StatementImport({ accounts, categories, currency, onImported, onClose }: Props) {
  const router = useRouter();
  const [fileName, setFileName] = useState("");
  const [rows, setRows] = useState<string[][]>([]);
  const [headerIndex, setHeaderIndex] = useState(0);
  const [mapping, setMapping] = useState<ColumnMapping | null>(null);
  const [dateFormat, setDateFormat] = useState<DateFormat>("dmy");
  const [amountMode, setAmountMode] = useState<AmountMode>("negative-is-expense");
  const [accountId, setAccountId] = useState("");
  const [paymentMethod, setPaymentMethod] = useState("bank");
  const [preview, setPreview] = useState<PreviewRow[] | null>(null);
  const [errors, setErrors] = useState<StatementError[]>([]);
  const [message, setMessage] = useState("");
  const [pending, setPending] = useState(false);
  const [lockedPdf, setLockedPdf] = useState<File | null>(null);
  const [pdfPassword, setPdfPassword] = useState("");
  const header = rows[headerIndex] ?? [];
  const dataRows = rows.slice(headerIndex + 1);

  function reset() {
    setFileName(""); setRows([]); setMapping(null); setPreview(null); setErrors([]); setLockedPdf(null); setPdfPassword("");
  }

  function applyHeader(allRows: string[][], index: number) {
    const guessed = guessMapping(allRows[index] ?? []);
    setHeaderIndex(index);
    setMapping(guessed);
    setAmountMode(guessed.debit !== null && guessed.credit !== null ? "debit-credit" : "negative-is-expense");
    setDateFormat(detectDateFormat(allRows.slice(index + 1).map((row) => row[guessed.date] ?? "")));
    setPreview(null);
  }

  function loadRows(name: string, parsed: string[][]) {
    setFileName(name);
    setRows(parsed);
    applyHeader(parsed, findHeaderRow(parsed));
  }

  async function loadPdf(file: File, password?: string) {
    setPending(true);
    let items;
    try {
      const { readPdfText, PdfPasswordError } = await import("@/lib/pdf-text");
      try {
        items = await readPdfText(file, password);
      } catch (error) {
        if (!(error instanceof PdfPasswordError)) throw error;
        setLockedPdf(file);
        return setMessage(error.incorrect ? "That password didn't work. Try again." : "This PDF is password-protected. Enter the password your bank uses for statements.");
      }
    } catch {
      return setMessage("That PDF couldn't be read. Try downloading the statement again, or use CSV.");
    } finally { setPending(false); }
    setLockedPdf(null); setPdfPassword("");
    if (!items.length) return setMessage("This PDF has no selectable text, so it's probably a scanned image. Download a CSV or a text PDF from your bank instead.");
    const parsed = pdfItemsToRows(items);
    if (parsed.length < 2) return setMessage("No statement table was found in that PDF.");
    loadRows(file.name, parsed);
  }

  async function chooseFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    reset(); setMessage("");
    const isPdf = file.type === "application/pdf" || /\.pdf$/i.test(file.name);
    if (file.size > (isPdf ? 10 : 5) * 1024 * 1024) return setMessage(`That file is over ${isPdf ? 10 : 5} MB. Export a shorter date range and try again.`);
    if (isPdf) return loadPdf(file);
    const parsed = parseCsv(await file.text());
    if (parsed.length < 2) return setMessage("That file doesn't look like a CSV statement with a header and rows.");
    loadRows(file.name, parsed);
  }

  async function send(body: object) {
    const response = await fetch("/api/transactions/import", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    if (response.status === 401) { router.replace("/login?error=session"); return null; }
    const result = await response.json().catch(() => ({}));
    if (!response.ok) { setMessage(result.error === "account" ? "Choose one of your accounts." : "The import could not be processed. Check the column choices and try again."); return null; }
    return result;
  }

  async function buildPreview() {
    if (!mapping) return;
    const normalized = normalizeStatement(dataRows, mapping, dateFormat, amountMode);
    setErrors(normalized.errors);
    if (!normalized.rows.length) { setPreview(null); return setMessage("No rows could be read. Check the date, description, and amount columns."); }
    if (normalized.rows.length > 1000) return setMessage("Import up to 1,000 rows at a time. Export a shorter date range and try again.");
    setPending(true); setMessage("");
    try {
      const result = await send({ mode: "preview", rows: normalized.rows.map(({ row: _row, ...item }) => item) });
      if (result) setPreview(result.rows.map((item: Omit<PreviewRow, "row" | "include">, index: number) => ({ ...item, row: normalized.rows[index].row, include: !item.duplicate })));
    } finally { setPending(false); }
  }

  async function commit() {
    const chosen = preview?.filter((row) => row.include) ?? [];
    if (!chosen.length) return setMessage("Select at least one row to import.");
    setPending(true); setMessage("");
    try {
      const result = await send({ mode: "commit", accountId: accountId || null, paymentMethod, rows: chosen.map(({ date, description, merchant, amount, type, category }) => ({ date, description, merchant, amount, type, category })) });
      if (!result) return;
      reset();
      onImported(result.imported);
    } finally { setPending(false); }
  }

  const updateRow = (index: number, change: Partial<PreviewRow>) => setPreview((current) => current?.map((row, position) => (position === index ? { ...row, ...change } : row)) ?? null);
  const columnSelect = (label: string, key: keyof ColumnMapping, optional = false) => mapping && <label>{label}<select value={mapping[key] ?? ""} onChange={(event) => { setMapping({ ...mapping, [key]: event.target.value === "" ? null : Number(event.target.value) }); setPreview(null); }}>{optional && <option value="">None</option>}{header.map((name, index) => <option key={index} value={index}>{name || `Column ${index + 1}`}</option>)}</select></label>;
  const selected = preview?.filter((row) => row.include) ?? [];

  return <section className="panel import-panel" id="import">
    <div className="panel-heading"><div><span className="panel-kicker">BRING YOUR STATEMENTS</span><h2>Import statement</h2></div><button type="button" className="icon-button modal-close" aria-label="Close import dialog" onClick={onClose}><X size={17} /></button></div>
    <p className="muted-copy">Upload a bank or card statement as CSV or PDF. You'll review every row before anything is saved, and rows already in your trail are unticked.</p>
    <div className="import-file-row"><label className="receipt-upload">{fileName ? "Choose another file" : "Choose CSV or PDF"}<input type="file" accept=".csv,text/csv,text/plain,.pdf,application/pdf" disabled={pending} onChange={(event) => void chooseFile(event)} /></label>{fileName && <span className="muted-copy">{fileName} · {dataRows.length} rows</span>}</div>
    {lockedPdf && <form className="import-password" onSubmit={(event) => { event.preventDefault(); void loadPdf(lockedPdf, pdfPassword); }}>
      <label>PDF password<input type="password" value={pdfPassword} onChange={(event) => setPdfPassword(event.target.value)} autoComplete="off" autoFocus required /></label>
      <button className="button button-dark button-small" disabled={pending || !pdfPassword}>Unlock</button>
      <small className="muted-copy">The password is used only in your browser to open the file and isn't saved.</small>
    </form>}
    {pending && !mapping && !lockedPdf && <p className="muted-copy" role="status">Reading statement…</p>}
    {mapping && <div className="import-mapping">
      <label>Header row<select value={headerIndex} onChange={(event) => applyHeader(rows, Number(event.target.value))}>{rows.slice(0, 15).map((row, index) => <option key={index} value={index}>Row {index + 1}: {row.filter(Boolean).slice(0, 3).join(", ").slice(0, 50)}</option>)}</select></label>
      {columnSelect("Date column", "date")}
      {columnSelect("Description column", "description")}
      {columnSelect("Merchant column", "merchant", true)}
      <label>Date format<select value={dateFormat} onChange={(event) => { setDateFormat(event.target.value as DateFormat); setPreview(null); }}><option value="dmy">Day first (31/01/2026)</option><option value="mdy">Month first (01/31/2026)</option></select></label>
      <label>Amounts<select value={amountMode} onChange={(event) => { setAmountMode(event.target.value as AmountMode); setPreview(null); }}><option value="negative-is-expense">One column, negative = money out</option><option value="positive-is-expense">One column, positive = money out (card statements)</option><option value="debit-credit">Separate debit and credit columns</option></select></label>
      {amountMode === "debit-credit" ? <>{columnSelect("Debit (money out)", "debit", true)}{columnSelect("Credit (money in)", "credit", true)}</> : columnSelect("Amount column", "amount", true)}
      <label>Account<select value={accountId} onChange={(event) => setAccountId(event.target.value)}><option value="">No account</option>{accounts.map((account) => <option key={account.id} value={account.id}>{account.name}</option>)}</select></label>
      <label>Payment method<select value={paymentMethod} onChange={(event) => setPaymentMethod(event.target.value)}><option value="bank">Bank</option><option value="card">Card</option><option value="upi">UPI</option><option value="wallet">Wallet</option><option value="cash">Cash</option></select></label>
      <div className="edit-actions"><button type="button" className="button button-dark button-small" disabled={pending} onClick={() => void buildPreview()}>Preview rows</button><button type="button" className="button button-light button-small" disabled={pending} onClick={reset}>Cancel</button></div>
    </div>}
    {errors.length > 0 && <p className="muted-copy">{errors.length} row{errors.length === 1 ? "" : "s"} skipped: {errors.slice(0, 5).map((error) => `row ${error.row} (${reasons[error.reason]})`).join(", ")}{errors.length > 5 ? "…" : ""}</p>}
    {preview && <>
      <div className="import-table-wrap"><table className="import-table">
        <thead><tr><th><input type="checkbox" aria-label="Select all rows" checked={selected.length === preview.length} onChange={(event) => setPreview(preview.map((row) => ({ ...row, include: event.target.checked })))} /></th><th>Date</th><th>Description</th><th>Category</th><th>Amount</th></tr></thead>
        <tbody>{preview.map((row, index) => <tr key={`${row.row}-${index}`} className={row.include ? undefined : "import-row-off"}>
          <td><input type="checkbox" aria-label={`Import ${row.description}`} checked={row.include} onChange={(event) => updateRow(index, { include: event.target.checked })} /></td>
          <td>{row.date}</td>
          <td>{row.description}{row.duplicate && <small className="import-duplicate">Already in your trail</small>}</td>
          <td><select aria-label={`Category for ${row.description}`} value={row.category} onChange={(event) => updateRow(index, { category: event.target.value })}>{[...new Set([row.category, ...categories.filter((category) => category.type === row.type).map((category) => category.name)])].map((name) => <option key={name} value={name}>{name}</option>)}</select></td>
          <td className={row.type === "income" ? "import-income" : undefined}>{row.type === "income" ? "+" : "−"}{formatMoney(row.amount, currency)}</td>
        </tr>)}</tbody>
      </table></div>
      <div className="edit-actions"><button type="button" className="button button-dark button-small" disabled={pending || !selected.length} onClick={() => void commit()}>Import {selected.length} transaction{selected.length === 1 ? "" : "s"}</button></div>
    </>}
    {message && <p className="muted-copy" role="status">{message}</p>}
  </section>;
}
