"use client";

import { useEffect, useState, type FormEvent } from "react";
import { Plus } from "lucide-react";

type Rule = { id: string; pattern: string; type: "expense" | "income"; category: string };
type Props = { categories: { name: string; type: string }[] };

export function CategoryRules({ categories }: Props) {
  const [rules, setRules] = useState<Rule[]>([]);
  const [type, setType] = useState<"expense" | "income">("expense");
  const [message, setMessage] = useState("");
  const [pending, setPending] = useState(false);
  const options = [...new Set(categories.filter((category) => category.type === type).map((category) => category.name))];

  useEffect(() => {
    fetch("/api/rules", { cache: "no-store" }).then((response) => response.json()).then((result) => { if (Array.isArray(result.rules)) setRules(result.rules); }).catch(() => setRules([]));
  }, []);

  async function addRule(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    setPending(true);
    try {
      const response = await fetch("/api/rules", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(Object.fromEntries(new FormData(form).entries())) });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) return setMessage(result.error === "rule-exists" ? "There's already a rule for that text." : "Enter at least 2 characters and choose a category.");
      setRules((current) => [...current, result.rule]);
      setMessage("Rule added. It applies to your next import.");
      form.reset(); setType("expense");
    } finally { setPending(false); }
  }

  async function removeRule(id: string) {
    setPending(true);
    try {
      const response = await fetch(`/api/rules/${id}`, { method: "DELETE" });
      if (!response.ok) return setMessage("That rule could not be removed. Please try again.");
      setRules((current) => current.filter((rule) => rule.id !== id));
      setMessage("Rule removed.");
    } finally { setPending(false); }
  }

  return <section className="panel settings-panel">
    <div className="panel-heading"><div><span className="panel-kicker">AUTOMATE</span><h2>Import rules</h2></div><span className="soft-icon"><Plus size={16} /></span></div>
    <p className="muted-copy settings-description">When an imported row's description or merchant contains this text, file it under the chosen category. The longest matching text wins.</p>
    <form className="settings-category-form" onSubmit={(event) => void addRule(event)}>
      <label>When text contains<input name="pattern" placeholder="e.g. swiggy" minLength={2} maxLength={100} required /></label>
      <label>Type<select name="type" value={type} onChange={(event) => setType(event.target.value as "expense" | "income")}><option value="expense">Expense</option><option value="income">Income</option></select></label>
      <label>Category<select name="category" required>{options.map((name) => <option key={name} value={name}>{name}</option>)}</select></label>
      <button className="button button-dark button-small" disabled={pending}>Add rule</button>
    </form>
    {message && <p className="muted-copy" role="status">{message}</p>}
    <div className="managed-list">
      <h3>Your rules</h3>
      {rules.length ? rules.map((rule) => <div className="managed-item" key={rule.id}>
        <div className="managed-item-heading"><span><b>“{rule.pattern}” → {rule.category}</b><small>{rule.type}</small></span><button type="button" className="text-danger" disabled={pending} onClick={() => void removeRule(rule.id)}>Remove</button></div>
      </div>) : <p className="muted-copy">No rules yet. Imported rows go to Other until you add some.</p>}
    </div>
  </section>;
}
