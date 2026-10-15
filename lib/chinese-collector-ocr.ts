/**
 * Card-number extraction, independent of OCR engine and image cropping.
 * Chinese printed cards commonly have Latin set codes next to numerals;
 * never use the Pokémon's HP, copyright year, or a random OCR number as ID.
 */
const CODE_PATTERN = "(?:[A-Z]{1,7}[0-9][A-Z0-9.\\-]{0,16}|[0-9]{2,4}[A-Z]|[A-Z]{1,3}-[A-Z])";
function numberDigits(value: string) {
  // OCR confuses zero/letter O and one/I in the *numeric fields*.
  return value.toUpperCase().replace(/O/g, "0").replace(/[IL|]/g, "1");
}
export function extractChineseCollectorNumber(ocrText: string): string {
  const normalized = ocrText.normalize("NFKC")
    .toUpperCase()
    .replace(/[／⁄|\\]/g, "/")
    .replace(/[：﹕]/g, ":");
  const context = normalized.replace(/\s+/g, " ").trim();
  // Reject general standalone numbers: card attacks, HP and copyrights
  // must never become a false-positive card identity.
  const pair = /(\d{1,4}[OIL]?)\s*\/\s*(\d{1,4}[OIL]?|(?:SV|SM|S)-P)\b/g;
  const candidates = [...context.matchAll(pair)];
  if (!candidates.length) {
    const codeNumber = new RegExp(`\\b(${CODE_PATTERN})\\s+([0-9OIL]{2,4})\\b`, "i").exec(context);
    if (!codeNumber) return "";
    return `${codeNumber[1]} ${numberDigits(codeNumber[2])}`;
  }
  const codeRegex = new RegExp(`\\b(${CODE_PATTERN})\\b`, "gi");
  let best = { value: "", score: -1 };
  for (const hit of candidates) {
    const number = numberDigits(hit[1]);
    const denom = /^\d/.test(hit[2]) ? numberDigits(hit[2]) : hit[2];
    if (!/^\d{1,4}$/.test(number)) continue;
    if (!/^(?:\d{1,4}|(?:SV|SM|S)-P)$/.test(denom)) continue;
    // Set codes are often printed immediately left of the collector number.
    const left = context.slice(Math.max(0, (hit.index ?? 0) - 48), hit.index);
    const nearby = [...left.matchAll(codeRegex)].at(-1)?.[1] || "";
    const distance = nearby ? left.length - left.lastIndexOf(nearby) - nearby.length : 999;
    const usefulCode = nearby && distance < 24 ? nearby : "";
    const candidate = usefulCode ? `${usefulCode} ${number}/${denom}` : `${number}/${denom}`;
    const score = (usefulCode ? 100 : 0) + (number.length >= 3 ? 4 : 0) +
      (denom.length >= 3 ? 4 : 0) - (hit.index ?? 0) * 0.0001;
    if (score > best.score) best = { value: candidate, score };
  }
  return best.value;
}
