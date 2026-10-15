/**
 * Manual Japanese collector numbers usually carry BOTH a printed set code
 * (SV4a, M1S, SV-P, etc.) and a number (123/190).
 * Never infer a card's set from its collector number alone.
 */
export type JapaneseCardQuery = {
  setId: string | null;
  collectorNumber: string | null;
  printedTotal: number | null;
};

export function normalizeJapaneseCollectorId(value: string | number): string {
  const compact = String(value).normalize("NFKC").trim().toUpperCase().replace(/\s+/g, "");
  const token = compact.split("/")[0] ?? "";
  return token.replace(/^0+(?=\d)/, "");
}

export function parseJapaneseCardQuery(
  number: string | undefined,
  explicitSet: string | undefined
): JapaneseCardQuery {
  const raw = (number ?? "").normalize("NFKC").trim().replace(/[／]/g, "/");
  const setField = (explicitSet ?? "").normalize("NFKC").trim();

  // Printed set code is optional, but always validated before making an HTTP request.
  const setCode = /^[A-Z][A-Z0-9-]{1,15}$/i;
  let setId = setCode.test(setField) ? setField.toLowerCase() : null;
  let collector = raw;

  // "SV4a 123/190", "M1S-001/063", "SV-P 005", including full-width digits.
  const prefixed = raw.match(/^([a-z][a-z0-9-]{1,15})[\s:_#-]+(\d{1,4}[a-z]?)(?:\s*\/\s*([a-z0-9-]{1,16}))?$/i);
  if (prefixed) {
    setId = setId ?? prefixed[1].toLowerCase();
    collector = prefixed[2] + (prefixed[3] ? "/" + prefixed[3] : "");
  } else {
    // "123/190 SV4a" is sometimes how collectors type the printed number.
    const trailing = raw.match(/^(\d{1,4}[a-z]?(?:\s*\/\s*\d{1,4})?)[\s:_#-]+([a-z][a-z0-9-]{1,15})$/i);
    if (trailing) {
      setId = setId ?? trailing[2].toLowerCase();
      collector = trailing[1];
    }
  }

  const parts = collector.replace(/\s+/g, "").toUpperCase().split("/");
  if (parts.length > 2 || !/^\d{1,4}[A-Z]?$/.test(parts[0])) {
    return { setId, collectorNumber: null, printedTotal: null };
  }

  const denominator = parts[1] ?? "";
  // Some Japanese promos print their set code after the slash: 012/SV-P.
  if (!setId && /^[A-Z][A-Z0-9-]{1,15}$/.test(denominator)) {
    setId = denominator.toLowerCase();
  }
  const printedTotal = /^\d{1,4}$/.test(denominator) ? Number(denominator) : null;
  return {
    setId,
    collectorNumber: parts[0],
    printedTotal,
  };
}

export function isJapaneseCardNumberMatch(localId: string, number: string): boolean {
  return normalizeJapaneseCollectorId(localId) === normalizeJapaneseCollectorId(number);
}
