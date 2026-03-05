import { normalizeLocale } from '../constants/locales.js';

const ARABIC_DIACRITICS = /[\u0610-\u061A\u064B-\u065F\u06D6-\u06ED]/g;

function transliterateBase(input: string): string {
  return input
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(ARABIC_DIACRITICS, '')
    .replace(/ß/g, 'ss')
    .replace(/ı/g, 'i')
    .replace(/İ/g, 'I')
    .replace(/ğ/g, 'g')
    .replace(/Ğ/g, 'G')
    .replace(/ş/g, 's')
    .replace(/Ş/g, 'S')
    .replace(/ç/g, 'c')
    .replace(/Ç/g, 'C')
    .replace(/ö/g, 'o')
    .replace(/Ö/g, 'O')
    .replace(/ü/g, 'u')
    .replace(/Ü/g, 'U')
    .replace(/ñ/g, 'n')
    .replace(/Ñ/g, 'N');
}

export function slugify(input: string, locale?: string): string {
  const safeLocale = normalizeLocale(locale);
  const transliterated = transliterateBase(input || '');

  const core = transliterated
    .toLocaleLowerCase(safeLocale)
    .replace(/[^a-z0-9\s-]/g, ' ')
    .trim()
    .replace(/[\s_-]+/g, '-')
    .replace(/-+/g, '-');

  return core || 'item';
}

export function withSlugCollision(baseSlug: string, attempt: number): string {
  if (attempt <= 1) return baseSlug;
  return `${baseSlug}-${attempt}`;
}
