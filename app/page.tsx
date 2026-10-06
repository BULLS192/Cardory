"use client";

import {
  BookOpen,
  Check,
  ChevronRight,
  CircleDollarSign,
  Camera,
  Grid2X2,
  Heart,
  LayoutDashboard,
  List,
  Plus,
  RefreshCw,
  Search,
  SlidersHorizontal,
  Sparkles,
  Star,
  Tags,
  Trash2,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import {
  AcquisitionType,
  Binder,
  CardGame,
  CardLanguage,
  CardCondition,
  CardSearchResult,
  CardVariant,
  CollectionState,
  OwnedCard,
  SmartRule,
  SmartRuleField,
  SmartRuleOperator,
  TcgDexCard,
} from "@/lib/types";
import { availableVariants, cardImage, extractMarketPrice, isPriceStale } from "@/lib/tcgdex";
import CardScanner from "@/components/CardScanner";
import CloudAccount, { type CloudStatus } from "@/components/CloudAccount";
import { getSupabaseBrowserClient } from "@/lib/supabase";
import {
  hasCollectionData,
  loadCloudState,
  prepareStateForCloud,
  saveCloudState,
} from "@/lib/cloud";

const STORAGE_KEY = "cardory-v1";
const LEGACY_STORAGE_KEYS = ["pokedex-vault-v1"];

const emptyState: CollectionState = {
  cards: [],
  binders: [],
  lastGlobalPriceSync: null,
};

type Tab = "dashboard" | "cards" | "binders" | "add";

function id() {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function money(value?: number | null, currency = "USD") {
  return typeof value === "numb¶»§q«^