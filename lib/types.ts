export type CardVariant = "normal" | "holofoil" | "reverse-holofoil" | "1st-edition" | "1st-edition-holofoil" | "unlimited" | "unlimited-holofoil";
export type CardCondition = "NM" | "LP" | "MP" | "HP" | "DMG";

export type TcgPriceVariant = {
  lowPrice?: number;
  midPrice?: number;
  highPrice?: number;
  marketPrice?: number;
  directLowPrice?: number;
};

export type TcgPlayerPricing = {
  updated?: number | string;
  unit?: string;
  normal?: TcgPriceVariant;
  holofoil?: TcgPriceVariant;
  "reverse-holofoil"?: TcgPriceVariant;
  "1st-edition"?: TcgPriceVariant;
  "1st-edition-holofoil"?: TcgPriceVariant;
  unlimited?: TcgPriceVariant;
  "unlimited-holofoil"?: TcgPriceVariant;
};

export type TcgDexCard = {
  id: string;
  localId: string | number;
  name: string;
  image?: string | null;
  rarity?: string | null;
  category?: string | null;
  illustrator?: string | null;
  hp?: number | null;
  types?: string[];
  stage?: string | null;
  variants?: {
    firstEdition?: boolean;
    holo?: boolean;
    normal?: boolean;
    reverse?: boolean;
    wPromo?: boolean;
  };
  variants_detailed?: Array<{
    type?: string;
    size?: string;
    variantId?: string;
    pricing?: {
      tcgplayer?: TcgPlayerPricing;
      cardmarket?: Record<string, string | number | undefined>;
    };
  }>;
  set?: {
    id: string;
    name: string;
    cardCount?: { official?: number; total?: number };
  };
  pricing?: {
    tcgplayer?: TcgPlayerPricing;
    cardmarket?: Record<string, string | number | undefined>;
  };
};

export type CardSearchResult = Pick<TcgDexCard, "id" | "localId" | "name" | "image"> & {\n  setName?: string;\n  rarity?: string | null;\n  source?: string;\n};

export type OwnedCard = {
  id: string;
  tcgdexId: string;
  name: string;
  localId: string;
  image?: string | null;
  setId?: string;
  setName?: string;
  rarity?: string | null;
  illustrator?: string | null;
  types?: string[];
  variant: CardVariant;
  condition: CardCondition;
  quantity: number;
  tags: string[];
  notes: string;
  favorite: boolean;
  marketPrice?: number | null;
  priceSource?: string | null;
  priceUpdatedAt?: string | null;
  addedAt: string;
};

export type SmartRuleField =
  | "tag"
  | "name"
  | "set"
  | "rarity"
  | "condition"
  | "favorite"
  | "marketPrice";

export type SmartRuleOperator = "contains" | "equals" | "gt" | "gte" | "lt" | "lte";

export type SmartRule = {
  field: SmartRuleField;
  operator: SmartRuleOperator;
  value: string;
};

export type Binder = {
  id: string;
  name: string;
  description?: string;
  kind: "manual" | "smart";
  cardIds: string[];
  rules: SmartRule[];
  match: "all" | "any";
  createdAt: string;
};

export type CollectionState = {
  cards: OwnedCard[];
  binders: Binder[];
  lastGlobalPriceSync?: string | null;
};
