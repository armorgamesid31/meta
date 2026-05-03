import { prisma } from '../prisma.js';

const RESERVED = new Set([
  'admin', 'api', 'app', 'www', 'dashboard', 'login', 'register', 'auth',
  'support', 'help', 'demo', 'test', 'staging', 'dev', 'billing', 'payment',
  'settings', 'kedy', 'kedyapp',
]);

export function normalizeSlugInput(input: string): string {
  return String(input || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, '-')
    .replace(/--+/g, '-')
    .replace(/^-+/, '')
    .replace(/-+$/, '');
}

export function validateSlugRules(slug: string): string | null {
  if (!slug) return 'slug_required';
  if (slug.length < 3) return 'slug_too_short';
  if (slug.length > 40) return 'slug_too_long';
  if (!/^[a-z0-9-]+$/.test(slug)) return 'slug_invalid_chars';
  if (slug.startsWith('-') || slug.endsWith('-')) return 'slug_invalid_edges';
  if (slug.includes('--')) return 'slug_double_dash';
  if (RESERVED.has(slug)) return 'slug_reserved';
  return null;
}

export async function checkSlugAvailability(raw: string): Promise<{
  available: boolean;
  normalizedSlug: string;
  domain?: string;
  suggestions?: string[];
  reason?: string;
}> {
  const normalizedSlug = normalizeSlugInput(raw);
  const violation = validateSlugRules(normalizedSlug);
  if (violation) {
    return { available: false, normalizedSlug, reason: violation };
  }

  const existing = await prisma.salon.findUnique({
    where: { slug: normalizedSlug },
    select: { id: true },
  });
  if (!existing) {
    return {
      available: true,
      normalizedSlug,
      domain: `${normalizedSlug}.kedyapp.com`,
    };
  }

  const suffixes = ['ankara', 'istanbul', String(new Date().getFullYear()), 'salon'];
  const suggestions = suffixes
    .map((s) => `${normalizedSlug}-${s}`)
    .map(normalizeSlugInput)
    .filter((s, i, arr) => s.length >= 3 && s.length <= 40 && arr.indexOf(s) === i)
    .slice(0, 3);

  return {
    available: false,
    normalizedSlug,
    suggestions,
  };
}

