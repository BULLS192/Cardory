"use client";

import { useState } from "react";
import { Check, Plus, Trash2 } from "lucide-react";
import type { Binder, SmartRule, SmartRuleField, SmartRuleOperator } from "@/lib/types";
import { type BinderUpdate, validateBinderUpdate } from "@/lib/binder-helpers";

/** Edit binder configuration in place. The original binder ID, creation
 * timestamp, card membership and owned-card rows are preserved. */
export default function EditBinder({
  binder, onSave, onCancel,
}: {
  binder: Binder;
  onSave: (update: BinderUpdate) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState(binder.name);
  const [description, setDescription] = useState(binder.description || "");
  const [rules, setRules] = useState<SmartRule[]>(binder.rules.map((rule) => ({ ...rule })));
  const [match, setMatch] = useState<Binder["match"]>(binder.match);
  const [error, setError] = useState("");

  function editRule(index: number, update: Partial<SmartRule>) {
    setRules((current) => current.map((rule, i) => {
      if (i !== index) return rule;
      if (update.field && update.field !== rule.field) {
        const field = update.field;
        return { field, operator: field === "marketPrice" ? "gte"
          : field === "favorite" ? "equals" : "contains",
          value: field === "favorite" ? "true" : "" };
      }
      return { ...rule, ...update };
    }));
    setError("");
  }

  function save() {
    const update = { name, description, rules, match };
    const issue = validateBinderUpdate(binder, update);
    if (issue) {
      setError(issue);
      return;
    }
    setError("");
    onSave(update);
  }

  return (
    <article className="panel binder-edit-form" aria-label="Edit binder details">
      <div className="panel-heading">
        <div><span className="eyebrow">Binder settings</span><h3>Edit binder</h3></div>
      </div>
      <div className="form-grid two">
        <label><span>Name</span>
          <input value={name} maxLength={100}
            onChange={(event) => setName(event.target.value)}
            placeholder="Binder name" />
        </label>
        <label><span>Description</span>
          <input value={description} maxLength={500}
            onChange={(event) => setDescription(event.target.value)}
            placeholder="Optional description" />
        </label>
      </div>
      {binder.kind === "smart" && (
        <div className="binder-rule-editor">
          <div className="panel-heading">
            <div><strong>Smart rules</strong>
              <p className="portfolio-footnote">Change the rules used to select your cards automatically.</p>
            </div>
            <button type="button" className="ghost"
              onClick={() => setRules((current) => [...current,
                { field: "tag", operator: "contains", value: "" }])}>
              <Plus size={15} /> Rule
            </button>
          </div>
          <label className="binder-rule-match"><span>Cards must match</span>
            <select value={match} onChange={(e) => setMatch(e.target.value as Binder["match"])}>
              <option value="all">All rules</option>
              <option value="any">Any rule</option>
            </select>
          </label>
          {rules.map((rule, index) => (
            <div key={index} className="binder-rule-row">
              <label><span>Field</span>
                <select value={rule.field}
                  onChange={(e) => editRule(index, { field: e.target.value as SmartRuleField })}>
                  <option value="tag">Tag</option>
                  <option value="name">Card name</option>
                  <option value="set">Set</option>
                  <option value="rarity">Rarity</option>
                  <option value="condition">Condition</option>
                  <option value="favorite">Favorite</option>
                  <option value="marketPrice">Market value (in card currency)</option>
                </select>
              </label>
              <label><span>Match</span>
                <select value={rule.operator}
                  onChange={(e) => editRule(index, { operator: e.target.value as SmartRuleOperator })}>
                  {rule.field === "marketPrice" ? (
                    <>
                      <option value="gte">≥</option><option value="gt">&gt;</option>
                      <option value="lte">≤</option><option value="lt">&lt;</option>
                      <option value="equals">=</option>
                    </>
                  ) : (
                    <>
                      {rule.field !== "favorite" && <option value="contains">contains</option>}
                      <option value="equals">equals</option>
                    </>
                  )}
                </select>
              </label>
              <label><span>Value</span>
                {rule.field === "favorite" ? (
                  <select value={rule.value}
                    onChange={(e) => editRule(index, { value: e.target.value })}>
                    <option value="true">Yes</option><option value="false">No</option>
                  </select>
                ) : (
                  <input value={rule.value} type={rule.field === "marketPrice" ? "number" : "text"}
                    min={rule.field === "marketPrice" ? 0 : undefined}
                    step={rule.field === "marketPrice" ? "0.01" : undefined}
                    onChange={(e) => editRule(index, { value: e.target.value })} />
                )}
              </label>
              <button type="button" className="ghost" title="Remove this rule"
                aria-label={"Remove rule " + (index + 1)}
                disabled={rules.length === 1}
                onClick={() => setRules((current) => current.filter((_, i) => i !== index))}>
                <Trash2 size={15} />
              </button>
            </div>
          ))}
        </div>
      )}
      {error && <p role="alert" className="form-error">{error}</p>}
      <div className="form-actions">
        <button type="button" className="ghost" onClick={onCancel}>Cancel</button>
        <button type="button" className="primary" onClick={save}>
          <Check size={15} /> Save binder
        </button>
      </div>
    </article>
  );
}
