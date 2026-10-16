"use client";

import type { CardSearchResult } from "./types";
import { cardImage } from "./tcgdex";
import { fingerprintPixels, fingerprintSimilarity, type ImageFingerprint } from "./scanner-recognition";

export type VisualCandidate = { card: CardSearchResult; similarity: number | null };
type DualFingerprint = { full: ImageFingerprint; art: ImageFingerprint };

const artworkCache = new Map<string, DualFingerprint | null>();
const MAX_CACHE = 250;
const MATCH_LIMIT = 16;
export const SET_ARTWORK_MATCH_LIMIT = 240;

function drawNormalized(source: CanvasImageSource, originalWidth: number, originalHeight: number): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = 240;
  canvas.height = 336;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) throw new Error("Canvas unavailable");
  // The user centers one upright card in the camera guide. Constrain the
  // captured area to card proportions before comparing with catalogue scans.
  const desired = 5 / 7;
  let width = originalWidth;
  let height = originalHeight;
  if (width / height > desired) width = height * desired;
  else height = width / desired;
  ctx.drawImage(source, (originalWidth - width) / 2, (originalHeight - height) / 2,
    width, height, 0, 0, canvas.width, canvas.height);
  return canvas;
}

function fingerprintArea(canvas: HTMLCanvasElement, x: number, y: number, w: number, h: number): ImageFingerprint {
  const resized = document.createElement("canvas");
  resized.width = 144;
  resized.height = 192;
  const ctx = resized.getContext("2d", { willReadFrequently: true });
  if (!ctx) throw new Error("Canvas unavailable");
  ctx.drawImage(canvas, x, y, w, h, 0, 0, resized.width, resized.height);
  return fingerprintPixels(ctx.getImageData(0, 0, resized.width, resized.height).data,
    resized.width, resized.height);
}

function fingerprints(canvas: HTMLCanvasElement): DualFingerprint {
  return {
    full: fingerprintArea(canvas, 0, 0, canvas.width, canvas.height),
    art: fingerprintArea(canvas, canvas.width * .08, canvas.height * .15,
      canvas.width * .84, canvas.height * .55),
  };
}

export function capturedCardFingerprints(canvas: HTMLCanvasElement): DualFingerprint {
  return fingerprints(drawNormalized(canvas, canvas.width, canvas.height));
}

async function referenceFingerprint(url: string): Promise<DualFingerprint | null> {
  if (artworkCache.has(url)) return artworkCache.get(url) ?? null;
  const source = await new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    const timeout = window.setTimeout(() => reject(new Error("Artwork timed out")), 5000);
    image.onload = () => { window.clearTimeout(timeout); resolve(image); };
    image.onerror = () => { window.clearTimeout(timeout); reject(new Error("Artwork unavailable")); };
    // Proxy only publicly listed catalogue-art domains. The user photo stays local.
    image.src = "/api/scanner/artwork?src=" + encodeURIComponent(url);
  }).catch(() => null);
  let value: DualFingerprint | null = null;
  if (source && source.naturalWidth >= 20 && source.naturalHeight >= 20) {
    try {
      value = fingerprints(drawNormalized(source, source.naturalWidth, source.naturalHeight));
    } catch { /* Keep OCR results available if a catalogue image cannot be read. */ }
  }
  artworkCache.set(url, value);
  if (artworkCache.size > MAX_CACHE) artworkCache.delete(artworkCache.keys().next().value!);
  return value;
}

function similarity(a: DualFingerprint, b: DualFingerprint): number {
  return .4 * fingerprintSimilarity(a.full, b.full) +
    .6 * fingerprintSimilarity(a.art, b.art);
}

/**
 * Conservative artwork-assisted re-ranking, not authoritative recognition:
 * a shared artwork can appear in several sets and foiling cannot be proven
 * from a single camera image. User confirmation remains required.
 */
export async function compareCatalogueArtwork(
  captured: HTMLCanvasElement,
  candidates: CardSearchResult[],
  onProgress?: (completed: number, total: number) => void,
  limit = MATCH_LIMIT
): Promise<VisualCandidate[]> {
  const target = capturedCardFingerprints(captured);
  const chosen = candidates.slice(0, Math.max(1, Math.min(SET_ARTWORK_MATCH_LIMIT, limit)));
  const result: VisualCandidate[] = new Array(chosen.length);
  let next = 0;
  let done = 0;
  await Promise.all(Array.from({ length: Math.min(8, chosen.length) }, async () => {
    while (next < chosen.length) {
      const index = next++;
      const card = chosen[index];
      const url = cardImage(card.image, "low");
      const ref = url ? await referenceFingerprint(url) : null;
      result[index] = { card, similarity: ref ? similarity(target, ref) : null };
      onProgress?.(++done, chosen.length);
    }
  }));
  return result.sort((a, b) => (b.similarity ?? -1) - (a.similarity ?? -1));
}
