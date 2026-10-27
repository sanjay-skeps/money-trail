"use client";

import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { useRouter } from "next/navigation";
import { RotateCcw, Send, Sparkles, X } from "lucide-react";
import { formatMoney } from "@/lib/currency";

type Added = { id: string; type: string; description: string; amount: string; category: string; date: string; undone?: boolean };
type Entry = { role: "user" | "assistant"; text: string; added?: Added[]; error?: boolean; streaming?: boolean };
type Props = { currency: string; onChange: () => void; onClose: () => void };

const errors: Record<string, string> = {
  unavailable: "The assistant isn't set up yet.",
  busy: "The AI model is busy right now. Wait a moment and send your message again.",
  upstream: "The AI provider returned an error. Please try again.",
  quota: "The AI provider account is out of credits. Add credits to its billing settings, then try again.",
  conversation: "This chat can't continue. Start a new chat and send your message again.",
  server: "Something went wrong on the server. Please try again.",
  network: "Couldn't reach the server. Check your connection and try again.",
  message: "Messages can be up to 4,000 characters.",
};

function localDate() {
  const now = new Date();
  return new Date(now.getTime() - now.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
}

export function TransactionAssistant({ currency, onChange, onClose }: Props) {
  const router = useRouter();
  const [entries, setEntries] = useState<Entry[]>([]);
  // The API's own transcript, returned by the server and sent back unchanged on the next message.
  const [conversation, setConversation] = useState<{ provider?: string; messages: unknown[] }>({ messages: [] });
  const [draft, setDraft] = useState("");
  const [pending, setPending] = useState(false);
  const log = useRef<HTMLDivElement>(null);

  useEffect(() => { log.current?.scrollTo({ top: log.current.scrollHeight, behavior: "smooth" }); }, [entries, pending]);

  function reset() { setEntries([]); setConversation({ messages: [] }); setDraft(""); }

  // The reply being streamed is always the last entry, because sending is disabled until it finishes.
  const updateReply = (change: (entry: Entry) => Entry) => setEntries((current) => [...current.slice(0, -1), change(current[current.length - 1])]);

  async function send(event?: FormEvent) {
    event?.preventDefault();
    const message = draft.trim();
    if (!message || pending) return;
    setEntries((current) => [...current, { role: "user", text: message }, { role: "assistant", text: "", added: [], streaming: true }]);
    setDraft(""); setPending(true);
    let saved = false;
    const fail = (error: string) => updateReply((entry) => ({ ...entry, text: errors[error] ?? "Something went wrong. Please try again.", error: true }));
    try {
      const response = await fetch("/api/assistant", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ message, today: localDate(), provider: conversation.provider, conversation: conversation.messages }) });
      if (response.status === 401) return router.replace("/login?error=session");
      if (!response.ok || !response.body) return fail((await response.json().catch(() => ({}))).error);
      // Newline-delimited JSON events; a chunk can end mid-line, so keep the remainder for the next read.
      const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
      let buffer = "", finished = false;
      while (!finished) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += value;
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines.filter(Boolean)) {
          const streamed = JSON.parse(line);
          if (streamed.type === "text") updateReply((entry) => ({ ...entry, text: entry.text + streamed.text }));
          else if (streamed.type === "added") { saved = true; updateReply((entry) => ({ ...entry, added: [...(entry.added ?? []), streamed.transaction] })); }
          else if (streamed.type === "done") {
            finished = true;
            setConversation({ provider: streamed.provider, messages: streamed.conversation });
            // Streamed text is kept; the final reply only fills in when the model said nothing (e.g. "Done.").
            updateReply((entry) => ({ ...entry, text: entry.text.trim() || streamed.reply }));
          } else if (streamed.type === "error") {
            finished = true;
            if (streamed.error === "conversation") setConversation({ messages: [] });
            fail(streamed.error);
          }
        }
      }
      if (!finished) fail("server");
    } catch {
      fail("network");
    } finally {
      updateReply((entry) => ({ ...entry, streaming: false }));
      setPending(false);
      if (saved) onChange();
    }
  }

  async function undo(id: string) {
    const response = await fetch(`/api/transactions/${id}`, { method: "DELETE" });
    if (!response.ok && response.status !== 404) return;
    setEntries((current) => current.map((entry) => ({ ...entry, added: entry.added?.map((item) => (item.id === id ? { ...item, undone: true } : item)) })));
    onChange();
  }

  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); void send(); }
  }

  return <section className="panel assistant-panel">
    <div className="panel-heading"><div><span className="panel-kicker">JUST SAY IT</span><h2>Add with AI</h2></div><div className="assistant-actions">{entries.length > 0 && <button type="button" className="button button-light button-small" onClick={reset} disabled={pending}><RotateCcw size={13} /> New chat</button>}<button type="button" className="icon-button modal-close" aria-label="Close assistant" onClick={onClose}><X size={17} /></button></div></div>
    <div className="assistant-log" ref={log} aria-live="polite">
      {!entries.length && <div className="assistant-empty"><Sparkles size={18} /><p>Describe a transaction or paste a bank SMS, and it will be saved for you.</p><ul><li>“Lunch at Swiggy 250 yesterday”</li><li>“Got salary 85,000 today”</li><li>“Rs.499.00 debited from A/c XX1234 on 27-10-26 to VPA netflix@icici UPI Ref 4321”</li></ul></div>}
      {entries.map((entry, index) => <div key={index} className={`assistant-message assistant-${entry.role}${entry.error ? " assistant-error" : ""}`}>
        {entry.text ? <p>{entry.text}</p> : entry.streaming && !entry.added?.length && <p className="muted-copy">Reading…</p>}
        {entry.added?.map((item) => <div key={item.id} className={`assistant-tx${item.undone ? " assistant-tx-undone" : ""}`}>
          <span><b>{item.description}</b><small>{item.category} · {item.date}</small></span>
          <b className={item.type === "income" ? "import-income" : undefined}>{item.type === "income" ? "+" : item.type === "expense" ? "−" : "↔"}{formatMoney(item.amount, currency)}</b>
          {item.undone ? <small>Undone</small> : <button type="button" className="text-danger" onClick={() => void undo(item.id)}>Undo</button>}
        </div>)}
      </div>)}
    </div>
    <form className="assistant-form" onSubmit={(event) => void send(event)}>
      <textarea aria-label="Message" value={draft} onChange={(event) => setDraft(event.target.value)} onKeyDown={onKeyDown} placeholder="Type a transaction or paste an SMS…" rows={3} maxLength={4000} disabled={pending} />
      <button className="button button-dark button-small" disabled={pending || !draft.trim()}><Send size={14} /> Send</button>
    </form>
    <small className="muted-copy">Messages and your category and account names are sent to the configured AI provider to read them.</small>
  </section>;
}
