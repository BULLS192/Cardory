import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  AcquisitionRecord,
  Binder,
  CardCondition,
  CardGame,
  CardLanguage,
  CardVariant,
  CollectionState,
  OwnedCard,
  SmartRule,
} from "@/lib/types";

type CollectionRow = {
  id: string;
  last_price_sync_at: string | null;
};

type BatchRow = {
  id: string;
  client_key: string | null;
  acquisition_type: AcquisitionRecord["type"] | null;
  batch_name: string | null;
  product: string | null;
  total_cost: number | string | null;
  currency: string | null;
  purchase_date: string | null;
  purchase_location: string | null;
  seller: string | null;
};

type CardRow = {
  id: string;
  acquisition_batch_id: string | null;
  provider_card_id: string;
  game: CardGame;
  language: CardLanguage;
  name: string;
  local_id: string;
  image_url: string | null;
  set_id: string | null;
  set_name: string | null;
  rarity: string | null;
  illustrator: string | null;
  types: string[] | null;
  variant: CardVariant;
  condition: CardCondition;
  quantity: number;
  custom_tags: string[] | null;
  smart_tags: string[] | null;
  notes: string | null;
  favorite: boolean;
  market_price: number | string | null;
  market_currency: string | null;
  price_source: string | null;
  price_updated_at: string | null;
  created_at: string;
};

type BinderRow = {
  id: string;
  name: string;
  description: string | null;
  kind: Binder["kind"];
  rules: SmartRule[] | null;
  rule_match: Binder["match"];
  create¶»§q«^