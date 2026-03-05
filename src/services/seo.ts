import { normalizeLocale } from '../constants/locales.js';

function getProtocol(host?: string): string {
  if (!host) return 'https';
  return host.includes('localhost') || host.startsWith('127.0.0.1') ? 'http' : 'https';
}

export function buildCanonical(host: string | undefined, path: string): string {
  const protocol = getProtocol(host);
  return `${protocol}://${host || 'localhost'}${path}`;
}

interface MetadataInput {
  locale: string;
  categoryName: string;
  salonName: string;
  categorySlug: string;
  cityName?: string | null;
  citySlug?: string | null;
  districtName?: string | null;
  districtSlug?: string | null;
  host?: string;
}

function formatTitle(parts: string[]): string {
  return parts.filter(Boolean).join(' | ');
}

export function buildCategoryMetadata(input: MetadataInput) {
  const locale = normalizeLocale(input.locale);
  const path = `/${locale}/category/${input.categorySlug}`;
  const canonical = buildCanonical(input.host, path);

  const title = formatTitle([input.categoryName, input.salonName]);
  const description = `${input.salonName} ${input.categoryName} hizmetleri, uzman kadro ve hizli online rezervasyon.`;

  return {
    title,
    description,
    canonical,
    ogTitle: title,
    ogDescription: description,
  };
}

export function buildCategoryCityMetadata(input: MetadataInput) {
  const locale = normalizeLocale(input.locale);
  const path = `/${locale}/${input.categorySlug}/${input.citySlug}`;
  const canonical = buildCanonical(input.host, path);

  const cityPart = input.cityName || input.citySlug || '';
  const title = formatTitle([`${cityPart} ${input.categoryName}`.trim(), input.salonName]);
  const description = `${cityPart} bolgesinde ${input.categoryName} hizmetleri icin ${input.salonName} ile hemen rezervasyon olusturun.`;

  return {
    title,
    description,
    canonical,
    ogTitle: title,
    ogDescription: description,
  };
}

export function buildCategoryLocationMetadata(input: MetadataInput) {
  const locale = normalizeLocale(input.locale);
  const path = `/${locale}/${input.categorySlug}/${input.citySlug}/${input.districtSlug}`;
  const canonical = buildCanonical(input.host, path);

  const cityPart = input.cityName || input.citySlug || '';
  const districtPart = input.districtName || input.districtSlug || '';
  const title = formatTitle([`${districtPart} ${cityPart} ${input.categoryName}`.trim(), input.salonName]);
  const description = `${districtPart} bolgesinde ${input.categoryName} hizmetleri icin ${input.salonName} ile online randevu alin.`;

  return {
    title,
    description,
    canonical,
    ogTitle: title,
    ogDescription: description,
  };
}
