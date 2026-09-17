import { sinhalaFmMap } from './sinhalaFmMap';

/**
 * Converts Sinhala Unicode text to FM Font legacy encoding.
 * Example: 'දහස' -> 'oyi'
 */
export function unicodeToFm(text: string): string {
  if (!text) return '';
  const result: string[] = [];
  let i = 0;
  const n = text.length;

  while (i < n) {
    let matched = false;
    // Check up to 5 characters for longest match
    for (let l = Math.min(5, n - i); l >= 1; l--) {
      const sub = text.substring(i, i + l);
      if (sinhalaFmMap[sub] !== undefined) {
        result.push(sinhalaFmMap[sub]);
        i += l;
        matched = true;
        break;
      }
    }
    if (!matched) {
      result.push(text[i]);
      i++;
    }
  }

  return result.join('');
}

const ONES: Record<number, string> = {
  0: 'බිංදුව',
  1: 'එක',
  2: 'දෙක',
  3: 'තුන',
  4: 'හතර',
  5: 'පහ',
  6: 'හය',
  7: 'හත',
  8: 'අට',
  9: 'නවය',
  10: 'දහය',
  11: 'එකොළහ',
  12: 'දොළහ',
  13: 'දහතුන',
  14: 'දහහතර',
  15: 'පහළොව',
  16: 'දහසය',
  17: 'දහහත',
  18: 'දහඅට',
  19: 'දහනවය',
};

const TEENS_THOUSANDS: Record<number, string> = {
  11: 'එකොළොස්',
  12: 'දොළොස්',
  13: 'දහතුන්',
  14: 'දහහතර',
  15: 'පහළොස්',
  16: 'දහසය',
  17: 'දහහත්',
  18: 'දහඅට',
  19: 'දහනව',
};

const TENS_STANDALONE: Record<number, string> = {
  20: 'විස්ස',
  30: 'තිහ',
  40: 'හතළිහ',
  50: 'පනහ',
  60: 'හැට',
  70: 'හැත්තෑව',
  80: 'අසූව',
  90: 'අනූව',
};

const TENS_PREFIX: Record<number, string> = {
  20: 'විසි',
  30: 'තිස්',
  40: 'හතළිස්',
  50: 'පනස්',
  60: 'හැට',
  70: 'හැත්තෑ',
  80: 'අසූ',
  90: 'අනූ',
};

const HUNDREDS_PREFIX: Record<number, string> = {
  1: 'එක්සිය',
  2: 'දෙසිය',
  3: 'තුන්සිය',
  4: 'හාරසිය',
  5: 'පන්සිය',
  6: 'හයසිය',
  7: 'හත්සිය',
  8: 'අටසිය',
  9: 'නවසිය',
};

const THOUSANDS_PREFIX: Record<number, string> = {
  1: 'එක්දහස්',
  2: 'දෙදහස්',
  3: 'තුන්දහස්',
  4: 'හාරදහස්',
  5: 'පන්දහස්',
  6: 'හයදහස්',
  7: 'හත්දහස්',
  8: 'අටදහස්',
  9: 'නවදහස්',
};

function convertUnder100(val: number, isStandalone = true): string {
  if (ONES[val] !== undefined) return ONES[val];
  if (isStandalone && TENS_STANDALONE[val]) return TENS_STANDALONE[val];
  const ten = Math.floor(val / 10) * 10;
  const rem = val % 10;
  if (rem === 0) return TENS_STANDALONE[ten] || '';
  const prefix = TENS_PREFIX[ten] || '';
  const unit = ONES[rem] || '';
  return prefix && unit ? `${prefix} ${unit}` : (prefix || unit);
}

function convertUnder1000(val: number, isStandalone = true): string {
  if (val < 100) return convertUnder100(val, isStandalone);
  const h = Math.floor(val / 100);
  const rem = val % 100;
  if (rem === 0) {
    if (h === 1 && isStandalone) return 'සියය';
    return (HUNDREDS_PREFIX[h] || '') + (isStandalone && h > 1 ? 'ය' : '');
  }
  const hWord = HUNDREDS_PREFIX[h] || '';
  const remWord = convertUnder100(rem, isStandalone);
  return `${hWord} ${remWord}`;
}

function convertGroup(val: number, isStandalone = true): string {
  if (val === 0) return isStandalone ? 'බිංදුව' : '';
  if (val < 1000) return convertUnder1000(val, isStandalone);

  // Exact 1000
  if (val === 1000 && isStandalone) return 'දහස';

  // 1,000 to 99,999 (Thousands)
  if (val < 100000) {
    const th = Math.floor(val / 1000);
    const rem = val % 1000;

    let thWord = '';
    if (th === 1) {
      thWord = (rem === 0 && isStandalone) ? 'දහස' : 'එක්දහස්';
    } else if (th === 10) {
      thWord = (rem === 0 && isStandalone) ? 'දසදහස' : 'දසදහස්';
    } else if (THOUSANDS_PREFIX[th]) {
      thWord = (rem === 0 && isStandalone) ? THOUSANDS_PREFIX[th].replace(/ස්$/, 'ස') : THOUSANDS_PREFIX[th];
    } else if (TEENS_THOUSANDS[th]) {
      thWord = (rem === 0 && isStandalone) ? `${TEENS_THOUSANDS[th]}දහස` : `${TEENS_THOUSANDS[th]}දහස්`;
    } else if (th % 10 === 0 && TENS_PREFIX[th]) {
      thWord = (rem === 0 && isStandalone) ? `${TENS_PREFIX[th]}දහස` : `${TENS_PREFIX[th]} දහස්`;
    } else {
      const ten = Math.floor(th / 10) * 10;
      const unit = th % 10;
      const tPrefix = TENS_PREFIX[ten] || '';
      const uPrefix = THOUSANDS_PREFIX[unit] || `${ONES[unit] || ''} දහස්`;
      thWord = `${tPrefix} ${uPrefix}`;
      if (rem === 0 && isStandalone) {
        thWord = thWord.replace(/ස්$/, 'ස');
      }
    }

    if (rem === 0) return thWord;
    const remWord = convertUnder1000(rem, isStandalone);
    return `${thWord} ${remWord}`;
  }

  // 100,000 to 999,999 (Lakhs)
  if (val < 1000000) {
    const lakh = Math.floor(val / 100000);
    const rem = val % 100000;
    let lakhWord = '';
    if (lakh === 1) {
      lakhWord = (rem === 0 && isStandalone) ? 'ලක්ෂය' : 'එක්ලක්ෂ';
    } else {
      const lBase = convertUnder100(lakh, false);
      lakhWord = (rem === 0 && isStandalone) ? `${lBase} ලක්ෂය` : `${lBase} ලක්ෂ`;
    }
    if (rem === 0) return lakhWord;
    return `${lakhWord} ${convertGroup(rem, isStandalone)}`;
  }

  // Millions (1,000,000 to 999,999,999)
  if (val < 1000000000) {
    const mil = Math.floor(val / 1000000);
    const rem = val % 1000000;
    const milWord = (mil === 1 && rem === 0 && isStandalone)
      ? 'මිලියනය'
      : `${convertUnder1000(mil, false)} මිලියන`;
    if (rem === 0) return milWord;
    return `${milWord} ${convertGroup(rem, isStandalone)}`;
  }

  // Billions (1,000,000,000+)
  const bil = Math.floor(val / 1000000000);
  const rem = val % 1000000000;
  const bilWord = (bil === 1 && rem === 0 && isStandalone)
    ? 'බිලියනය'
    : `${convertUnder1000(bil, false)} බිලියන`;
  if (rem === 0) return bilWord;
  return `${bilWord} ${convertGroup(rem, isStandalone)}`;
}

/**
 * Converts a numeric value or string to its formal Sinhala words representation.
 * Example: 1000 -> 'දහස'
 * Example: 25 -> 'විසි පහ'
 */
export function numberToSinhalaWords(numInput: string | number): string {
  if (numInput === undefined || numInput === null) return '';
  let numStr = String(numInput).replace(/,/g, '').replace(/(\/-|\$-)\s*$/, '').trim();
  if (!numStr) return '';

  let isNegative = false;
  if (numStr.startsWith('-')) {
    isNegative = true;
    numStr = numStr.slice(1).trim();
  }

  const parts = numStr.split('.');
  const intStr = parts[0] || '0';
  const decStr = parts.length > 1 ? parts[1] : null;

  const n = parseInt(intStr, 10);
  if (isNaN(n)) return '';

  let res = convertGroup(n, true);

  if (decStr !== null && decStr !== '') {
    const digitsMap: Record<string, string> = {
      '0': 'බිංදුව',
      '1': 'එක',
      '2': 'දෙක',
      '3': 'තුන',
      '4': 'හතර',
      '5': 'පහ',
      '6': 'හය',
      '7': 'හත',
      '8': 'අට',
      '9': 'නවය',
    };
    const decWords = decStr.split('').map(d => digitsMap[d] || d).join(' ');
    res = res ? `${res} දශම ${decWords}` : `දශම ${decWords}`;
  }

  if (isNegative) res = `ඍණ ${res}`;
  return res;
}

/**
 * Main conversion function:
 * Converts a number to Sinhala in either 'unicode' or 'fm' font representation.
 *
 * Example:
 * convertNumberToSinhala(1000, 'fm') -> 'oyi'
 * convertNumberToSinhala(1000, 'unicode') -> 'දහස'
 */
export function convertNumberToSinhala(
  numInput: string | number,
  mode: 'fm' | 'unicode' = 'fm'
): string {
  const unicodeWords = numberToSinhalaWords(numInput);
  if (!unicodeWords) return '';

  if (mode === 'unicode') {
    return unicodeWords;
  }

  return unicodeToFm(unicodeWords);
}

/**
 * Detects whether a font family name is a Unicode font or a legacy FM/DL ANSI font.
 * - Legacy ANSI fonts typically start with FM, DL, DS, KDU, etc.
 * - System fonts (sans-serif, Arial, etc.) and Sinhala Unicode fonts (Nidahasa, Aragalaya, Iskoola Pota, Noto Sans Sinhala, etc.) are Unicode.
 */
export function isUnicodeFont(fontFamily?: string, mode?: 'fm' | 'unicode'): boolean {
  if (mode === 'unicode') return true;
  if (mode === 'fm') return false;
  if (!fontFamily) return true;
  const lower = fontFamily.toLowerCase().trim();
  if (lower === 'sans-serif' || lower === 'system sans' || lower === 'serif' || lower === 'monospace') {
    return true;
  }
  if (/^(fm[-_\s]?|dl[-_\s]?|ds[-_\s]?)/i.test(lower)) {
    return false;
  }
  return true;
}

/**
 * Formats a numeric value or string for rendering on the image canvas:
 * - If value is greater than or equal to 10000, formats with thousand separator commas (e.g. 10,000 / 25,000).
 * - Suffix at end of number:
 *   - For Unicode fonts (or unicode mode): uses '/-' instead of '$-' (e.g. 10,000/- or 1000/-)
 *   - For FM fonts (or fm mode): uses '$-' (which renders as '/-' in FM fonts)
 *   - Or uses explicit suffix if provided ('/-' or '$-')
 */
export function formatNumberForCanvas(
  numInput: string | number,
  explicitSuffix?: string,
  fontFamily?: string,
  mode?: 'fm' | 'unicode'
): string {
  if (numInput === undefined || numInput === null) return '';
  let str = String(numInput).trim();
  if (!str) return '';

  // Determine suffix: explicit > font/mode check
  let suffix = explicitSuffix;
  if (!suffix || suffix === 'auto') {
    const isUnicode = isUnicodeFont(fontFamily, mode);
    suffix = isUnicode ? '/-' : '$-';
  } else if (mode === 'unicode' && suffix === '$-') {
    // When Linked Number Label is unicode, use '/-' instead of '$-'
    suffix = '/-';
  }

  // Strip existing trailing /- or $- if already present
  str = str.replace(/(\/-|\$-)\s*$/, '').trim();
  if (!str) return '';

  // Remove commas to parse number
  const cleanStr = str.replace(/,/g, '').trim();
  const numVal = parseFloat(cleanStr);

  if (isNaN(numVal)) {
    // If not a parseable number, append suffix
    return `${str}${suffix}`;
  }

  const isNegative = cleanStr.startsWith('-');
  const unsignedStr = isNegative ? cleanStr.slice(1) : cleanStr;

  const parts = unsignedStr.split('.');
  let intPart = parts[0] || '0';
  const decPart = parts.length > 1 ? `.${parts[1]}` : '';

  // If value is greater than or equal to 10000, add thousand separator comma
  if (Math.abs(numVal) >= 10000) {
    intPart = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  }

  const formattedNum = (isNegative ? '-' : '') + intPart + decPart;
  return `${formattedNum}${suffix}`;
}

