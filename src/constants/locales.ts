export const SUPPORTED_LOCALES = ['tr', 'en', 'es', 'fr', 'de', 'pt', 'ru', 'zh', 'ar', 'hi'] as const;

export type SupportedLocale = (typeof SUPPORTED_LOCALES)[number];

export const DEFAULT_LOCALE: SupportedLocale = 'tr';

export function normalizeLocale(value?: string | null): SupportedLocale {
  if (!value) return DEFAULT_LOCALE;
  const short = value.toLowerCase().split('-')[0] as SupportedLocale;
  return SUPPORTED_LOCALES.includes(short) ? short : DEFAULT_LOCALE;
}
