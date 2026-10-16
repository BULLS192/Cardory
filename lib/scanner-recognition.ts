/**
 * On-device scanner primitives. Recognition and image comparison never upload
 * a photograph of an owned card; catalogue artwork is fetched separately.
 */
export type ScanIdentity = {
  number: string;
  setCode: string | null;
  confidence: "high" | "medium" | "low";
};

const PRINTED_CODE = "(?:[A-Z]{1,6}[0-9][A-Z0-9.\\-]{0,13}|(?:SV|SM|S)-P)";
const PRINTED_NUMBER = "([0-9OIL]{1,4}[A-Z]?)\\s*[/]\\s*([0-9OIL]{1,4}|(?:SV|SM|S)-P)";
const CODE_FIRST = new RegExp("\\b(" + PRINTED_CODE + ")\\s*[:#\\-]?\\s*" + PRINTED_NUMBER + "\\b", "i");
const NUMBER_FIRST = new RegExp("\\b" + PRINTED_NUMBER + "\\s+(" + PRINTED_CODE + ")\\b", "i");
const NUMBER_ONLY = new RegExp("\\b" + PRINTED_NUMBER + "\\b", "i");

function cleanNumericPart(part: string): string {
  return part.toUpperCase().replace(/O/g, "0").replace(/[IL]/g, "1");
}

function printedNumber(a: string, b: string): string {
  const numerator = cleanNumericPart(a);
  const denominator = /^[0-9OIL]+$/i.test(b) ? cleanNumericPart(b) : b.toUpperCase();
  return numerator + "/" + denominator;
}

export function parsePrintedIdentity(raw: string): ScanIdentity | null {
  const text = raw.normalize("NFKC").toUpperCase()
    .replace(/[／⁄|\\]/g, "/").replace(/[\u00a0\u2000-\u200b]/g, " ")
    .replace(/\s+/g, " ").trim();
  if (!text) return null;

  const first = CODE_FIRST.exec(text);
  if (first) {
    return { setCode: first[1], number: printedNumber(first[2], first[3]), confidence: "high" };
  }
  const trailing = NUMBER_FIRST.exec(text);
  if (trailing) {
    return { setCode: trailing[3], number: printedNumber(trailing[1], trailing[2]), confidence: "high" };
  }
  const lone = NUMBER_ONLY.exec(text);
  if (lone) {
    return { setCode: null, number: printedNumber(lone[1], lone[2]), confidence: "medium" };
  }
  // No unqualified 2-4 digit guesses: HP, attacks and copyright years can
  // otherwise become false card identities.
  return null;
}

export type ImageFingerprint = {
  gradients: number[];
  colors: number[];
};

/** Cheap, deterministic visual signature; intended to rank catalogue candidates,
 * not to authenticate a printing or infer a foil finish. */
export function fingerprintPixels(pixels: Uint8ClampedArray, width: number, height: number): ImageFingerprint {
  if (width < 2 || height < 2 || pixels.length < width * height * 4) {
    throw new Error("Invalid image data");
  }
  const sample = (x: number, y: number) => {
    const col = Math.max(0, Math.min(width - 1, Math.floor((x + 0.5) * width)));
    const row = Math.max(0, Math.min(height - 1, Math.floor((y + 0.5) * height)));
    const i = (row * width + col) * 4;
    return [pixels[i], pixels[i + 1], pixels[i + 2]];
  };
  const gradients: number[] = [];
  for (let y = 0; y < 8; y++) {
    for (let x = 0; x < 8; x++) {
      const a = sample(x / 9, y / 8);
      const b = sample((x + 1) / 9, y / 8);
      const gray = (v: number[]) => v[0] * .299 + v[1] * .587 + v[2] * .114;
      gradients.push(gray(a) > gray(b) ? 1 : 0);
    }
  }
  const colors: number[] = [];
  for (let y = 0; y < 6; y++) {
    for (let x = 0; x < 4; x++) {
      const [r, g, b] = sample(x / 4, y / 6);
      const sum = Math.max(1, r + g + b);
      // Relative channel color survives global changes in exposure.
      colors.push(r / sum, g / sum, b / sum);
    }
  }
  return { gradients, colors };
}

export function fingerprintSimilarity(a: ImageFingerprint, b: ImageFingerprint): number {
  if (a.gradients.length !== 64 || b.gradients.length !== 64 ||
      a.colors.length !== 72 || b.colors.length !== 72) return 0;
  let bitsDifferent = 0;
  for (let i = 0; i < 64; i++) if (a.gradients[i] !== b.gradients[i]) bitsDifferent++;
  let channelDifference = 0;
  for (let i = 0; i < 72; i++) channelDifference += Math.abs(a.colors[i] - b.colors[i]);
  const structural = 1 - bitsDifferent / 64;
  const color = 1 - Math.min(1, channelDifference / 48);
  return Math.max(0, Math.min(1, .75 * structural + .25 * color));
}
