export type CardGame = "pokemon" | "riftbound";
export type CardLanguage = "English" | "Japanese" | "Chinese";
export type CardVariant = "normal" | "foil" | "holofoil" | "reverse-holofoil" | "1st-edition" | "1st-edition-holofoil" | "unlimited" | "unlimited-holofoil";
export type CardCondition = "NM" | "LP" | "MP" | "HP" | "DMG";
export type AcquisitionType = "pack" | "single" | "sealed" | "trade" | "gift" | "other";

export type AcquisitionRecord = {
  type?: AcquisitionType;
  batchId?: string;
  batchName?: string;
  product?: string;
  totalCost?: number | null;
  currency?: string;
  date?: string;
  location?: string;
  seller?: string;
};

export type TcgPriceVariant = {
  lowPrice?: number;
  midPrice?: number;
  highPrice?: number;
  marketPrice?: number;
  directLowPrice?: number | null;
};

export type TcgPlayerPricing = {
  updated?: number | string;
  unit?: string;
  normal?: TcgPriceVariant;
  foil?: TcgPriceVariant;
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
  dexId?: number[];
  cameoDexIds?: number[];
  stage?: string | null;
  game?: CardGame;
  language?: CardLanguage;
  marketCurrency?: string | null;
  variants?: {
    firstEdition?: boolean;
    foil?: boolean;
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

export type CardSearchResult = Pick<TcgDexCard, "id" | "localId" | "name" | "image"> & {
  setName?: string;
  rarity?: string | null;
  source?: string;
  game?: CardGame;
  language?: CardLanguage;
};

export type OwnedCard = {
  id: string;
  tcgdexId: string;
  game?: CardGame;
  language?: CardLanguage;
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
  smartTags?: string[];
  notes: string;
  acquisition?: AcquisitionRecord;
  favorite: boolean;
  marketPrice?: number | null;
  marketCurrency?: string | null;
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
