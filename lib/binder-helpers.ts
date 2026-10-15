import type { Binder, SmartRule, SmartRuleField, SmartRuleOperator } from "./types";

export type BinderInput = {
  name: string;
  description: string;
  kind: Binder["kind"];
  cardIds: string[];
  field: SmartRuleField;
  operator: SmartRuleOperator;
  value: string;
};

export function validateBinder(input: BinderInput): string | null {
  if (!input.name.trim()) return "Enter a binder name.";
  if (input.name.trim().length > 100) return "Binder name must be 100 characters or less.";
  if (input.kind === "smart") {
    if (!input.value.trim()) return "Enter a value for the smart binder rule.";
    if (input.field === "marketPrice" &&
        (!Number.isFinite(Number(input.value)) || Number(input.value) < 0))
      return "Enter a non-negative market value.";
  }
  return null;
}

export function newBinder(input: BinderInput, binderId: string, timestamp: string): Binder {
  const error = validateBinder(input);
  if (error) throw new Error(error);
  const value = input.field === "favorite" ? input.value.trim() || "true" : input.value.trim();
  const rules: SmartRule[] = input.kind === "smart"
    ? [{ field: input.field, operator: input.operator, value }] : [];
  return {
    id: binderId,
    name: input.name.trim(),
    description: input.description.trim(),
    kind: input.kind,
    cardIds: input.kind === "manual" ? [...new Set(input.cardIds)] : [],
    rules,
    match: "all",
    createdAt: timestamp,
  };
}

export function replaceBinderCards(binders: Binder[], binderId: string, cardIds: string[]) {
  return binders.map((binder) =>
    binder.id === binderId && binder.kind === "manual"
      ? { ...binder, cardIds: [...new Set(cardIds)] } : binder
  );
}

export type BinderUpdate = {
  name: string;
  description: string;
  rules: SmartRule[];
  match: Binder["match"];
};

export function validateBinderUpdate(binder: Binder, update: BinderUpdate): string | null {
  if (!update.name.trim()) return "Enter a binder name.";
  if (update.name.trim().length > 100) return "Binder name must be 100 characters or less.";
  if (update.description.length > 500) return "Description must be 500 characters or less.";
  if (binder.kind === "smart") {
    if (!update.rules.length) return "Keep at least one smart binder rule.";
    for (const rule of update.rules) {
      if (!rule.value.trim()) return "Every smart binder rule needs a value.";
      if (rule.field === "marketPrice") {
        if (!Number.isFinite(Number(rule.value)) || Number(rule.value) < 0)
          return "Enter a non-negative market value.";
        if (!["gt", "gte", "lt", "lte", "equals"].includes(rule.operator))
          return "Choose a valid market value comparison.";
      } else if (!["contains", "equals"].includes(rule.operator) ||
        rule.field === "favorite" && !["true", "false"].includes(rule.value)) {
        return "Choose a valid rule operator or favorite value.";
      }
    }
  }
  return null;
}

/** Modify binder metadata, not identity, physical card records or membership. */
export function replaceBinderDetails(
  binders: Binder[], binderId: string, update: BinderUpdate
): Binder[] {
  return binders.map((binder) => {
    if (binder.id !== binderId) return binder;
    const error = validateBinderUpdate(binder, update);
    if (error) throw new Error(error);
    return {
      ...binder,
      name: update.name.trim(),
      description: update.description.trim(),
      rules: binder.kind === "smart" ? update.rules.map((rule) => ({
        field: rule.field, operator: rule.operator, value: rule.value.trim(),
      })) : binder.rules,
      match: binder.kind === "smart" ? update.match : binder.match,
    };
  });
}
