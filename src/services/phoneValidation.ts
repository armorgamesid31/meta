import {
  getCountryCallingCode,
  isSupportedCountry,
  parsePhoneNumberFromString,
  type CountryCode,
  type NumberType,
} from 'libphonenumber-js/max';

export type NormalizedPhoneResult = {
  countryIso: string;
  e164: string;
  digits: string;
  national: string;
  callingCode: string;
  numberType: NumberType | undefined;
};

function normalizeCountryIso(input: string | null | undefined): CountryCode | null {
  const value = String(input || '').trim().toUpperCase();
  if (!value || !isSupportedCountry(value as CountryCode)) return null;
  return value as CountryCode;
}

function normalizeDigits(value: string | null | undefined): string {
  return String(value || '').replace(/\D/g, '');
}

function isAcceptedMobileType(type: NumberType | undefined): boolean {
  return type === 'MOBILE' || type === 'FIXED_LINE_OR_MOBILE';
}

export function validateMobilePhone(input: {
  rawPhone: string | null | undefined;
  countryIso: string | null | undefined;
  normalizedPhone?: string | null | undefined;
}): NormalizedPhoneResult {
  const countryIso = normalizeCountryIso(input.countryIso);
  if (!countryIso) {
    throw new Error('unsupported_country');
  }

  const rawPhone = String(input.rawPhone || '').trim();
  if (!rawPhone) {
    throw new Error('phone_required');
  }

  const parsed = parsePhoneNumberFromString(rawPhone, countryIso);
  if (!parsed || !parsed.isValid()) {
    throw new Error('invalid_phone');
  }

  const type = parsed.getType();
  if (!isAcceptedMobileType(type)) {
    throw new Error('mobile_phone_required');
  }

  const e164 = parsed.number;
  const digits = normalizeDigits(e164);
  const providedNormalized = normalizeDigits(input.normalizedPhone);
  if (providedNormalized && providedNormalized !== digits) {
    throw new Error('phone_normalization_mismatch');
  }

  return {
    countryIso,
    e164,
    digits,
    national: parsed.formatNational(),
    callingCode: getCountryCallingCode(countryIso),
    numberType: type,
  };
}

export function normalizeDigitsOnly(value: string | null | undefined): string {
  return normalizeDigits(value);
}

/**
 * Resolve a libphonenumber region from a salon's stored country code, falling
 * back to 'TR' (the platform's home market) when missing/invalid.
 */
export function resolveRegion(countryCode: string | null | undefined): CountryCode {
  const up = String(countryCode || '').trim().toUpperCase();
  return up && isSupportedCountry(up as CountryCode) ? (up as CountryCode) : 'TR';
}

/**
 * Canonical E.164 form ("+905312006807") for COMPARING / LOOKING UP phone
 * numbers — NOT for storing new records (use validateMobilePhone for that).
 *
 * Phones live in the system in mixed shapes (E.164 "905…", national
 * "5312006807", formatted "(531) 200 68 07", leading-zero "0531…"). A raw
 * digit-strip compares unequal across these, silently breaking ban checks,
 * customer lookups, dedupe, etc. This normalises both sides to one form:
 *   - national numbers resolve via `region` (the salon's country, fallback TR)
 *   - foreign numbers that carry their own country code resolve via the
 *     international ("+" + digits) fallback — so it is foreign-compatible
 *   - un-parseable input falls back to raw digits so equality still works.
 */
export function canonicalPhone(value: string | null | undefined, region: CountryCode = 'TR'): string {
  const digits = normalizeDigits(value);
  if (!digits) return '';
  const national = parsePhoneNumberFromString(digits, region);
  if (national && national.isValid()) return national.number;
  const intl = parsePhoneNumberFromString('+' + digits);
  if (intl && intl.isValid()) return intl.number;
  return digits;
}

/**
 * Canonical E.164 DIGITS (no leading "+", e.g. "905312006807"). Matches how
 * WhatsApp identity keys (`subjectNormalized`) are stored (digits only). Use
 * for identity-session / subjectNormalized lookups so a customer phone in any
 * shape resolves to the stored key.
 */
export function canonicalPhoneDigits(value: string | null | undefined, region: CountryCode = 'TR'): string {
  return normalizeDigits(canonicalPhone(value, region));
}
