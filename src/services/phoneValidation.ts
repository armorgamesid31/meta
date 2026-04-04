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
