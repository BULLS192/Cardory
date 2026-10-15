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
