// Brand tone derivation — ports v0-salon-booking-frontend/lib/theme/devDerive.ts
// so backend output matches the frontend dev fallback for the same brand input.
// In production the frontend consumes the resolved block returned by the API.

export type PresetId = 'minimal' | 'glass' | 'editorial' | 'classic';

export interface ResolvedThemeTokens {
  brand: string;
  brand50: string;
  brand100: string;
  brand500: string;
  brand600: string;
  brand700: string;
  brandForeground: string;

  bgBase: string;
  surface: string;
  surfaceMobileFallback?: string;
  surface2: string;
  border: string;
  borderSoft?: string;
  ink: string;
  ink2: string;
  ink3: string;

  radius: number;
  radiusLg: number;
  shadow: string;
  shadowLg: string;
  cardBlur: string;

  fontDisplay: string;
  fontBody: string;
}

// Default brand color per preset — keep in sync with
// v0-salon-booking-frontend/lib/theme/presets.ts PRESET_DEFAULT_BRAND.
export const PRESET_DEFAULT_BRAND: Record<PresetId, string> = {
  minimal: '#10B981',
  glass: '#D4A574',
  editorial: '#DC2626',
  classic: '#F1841F',
};

export const PRESET_IDS: readonly PresetId[] = ['minimal', 'glass', 'editorial', 'classic'];

export function isPresetId(value: unknown): value is PresetId {
  return typeof value === 'string' && (PRESET_IDS as readonly string[]).includes(value);
}

const HEX_RE = /^#[0-9A-Fa-f]{6}$/;

export function parseHex(hex: string): { r: number; g: number; b: number } | null {
  if (typeof hex !== 'string' || !HEX_RE.test(hex.trim())) return null;
  const n = parseInt(hex.trim().slice(1), 16);
  return { r: (n >> 16) & 0xff, g: (n >> 8) & 0xff, b: n & 0xff };
}

export function normalizeHex(hex: string): string | null {
  if (typeof hex !== 'string') return null;
  const trimmed = hex.trim();
  if (!HEX_RE.test(trimmed)) return null;
  return trimmed.toUpperCase();
}

type Hsl = { h: number; s: number; l: number };

export function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  let h = 0;
  let s = 0;
  const l = (max + min) / 2;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case rn:
        h = (gn - bn) / d + (gn < bn ? 6 : 0);
        break;
      case gn:
        h = (bn - rn) / d + 2;
        break;
      case bn:
        h = (rn - gn) / d + 4;
        break;
    }
    h /= 6;
  }
  return [h * 360, s * 100, l * 100];
}

export function hslToHex(h: number, s: number, l: number): string {
  const sn = s / 100;
  const ln = l / 100;
  const c = (1 - Math.abs(2 * ln - 1)) * sn;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = ln - c / 2;
  let r = 0;
  let g = 0;
  let b = 0;
  if (h < 60) {
    r = c;
    g = x;
  } else if (h < 120) {
    r = x;
    g = c;
  } else if (h < 180) {
    g = c;
    b = x;
  } else if (h < 240) {
    g = x;
    b = c;
  } else if (h < 300) {
    r = x;
    b = c;
  } else {
    r = c;
    b = x;
  }
  const toHex = (v: number): string => {
    const i = Math.round((v + m) * 255);
    return Math.max(0, Math.min(255, i)).toString(16).padStart(2, '0');
  };
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`.toUpperCase();
}

export function relativeLuminance(hex: string): number {
  const rgb = parseHex(hex);
  if (!rgb) throw new Error(`Invalid hex: ${hex}`);
  const lin = (c: number): number => {
    const cn = c / 255;
    return cn <= 0.03928 ? cn / 12.92 : Math.pow((cn + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * lin(rgb.r) + 0.7152 * lin(rgb.g) + 0.0722 * lin(rgb.b);
}

export function contrastRatio(fg: string, bg: string): number {
  const l1 = relativeLuminance(fg);
  const l2 = relativeLuminance(bg);
  const lighter = Math.max(l1, l2);
  const darker = Math.min(l1, l2);
  return (lighter + 0.05) / (darker + 0.05);
}

const INK_DARK = '#252527';
const INK_LIGHT = '#FFFFFF';

// Returns the foreground (white or ink) with the better contrast against brand.
// Ties to white — Anthropic-style preference for high-saturation light text on
// brand surfaces in product UI.
export function pickForeground(brandHex: string): string {
  const cWhite = contrastRatio(INK_LIGHT, brandHex);
  const cDark = contrastRatio(INK_DARK, brandHex);
  return cWhite >= cDark ? INK_LIGHT : INK_DARK;
}

// Frontend feature flag blocks pastels client-side; backend is the AA-contrast
// guardrail. Threshold matches BACKEND_HANDOFF.md §2 (luminance > 0.85).
export function isBlockedPastel(hex: string): boolean {
  const rgb = parseHex(hex);
  if (!rgb) return false;
  return relativeLuminance(hex) > 0.85;
}

interface PresetSurface {
  bgBase: string;
  surface: string;
  surfaceMobileFallback?: string;
  surface2: string;
  border: string;
  borderSoft?: string;
  ink: string;
  ink2: string;
  ink3: string;
  radius: number;
  radiusLg: number;
  shadow: string;
  shadowLg: string;
  cardBlur: string;
  fontDisplay: string;
  fontBody: string;
}

// Preset surfaces mirror v0-salon-booking-frontend/lib/theme/devDerive.ts
// PRESET_SURFACES verbatim — the backend is the source of truth so any future
// adjustments land here first.
const PRESET_SURFACES: Record<PresetId, PresetSurface> = {
  minimal: {
    bgBase: '#fafafa',
    surface: '#ffffff',
    surface2: '#f4f4f5',
    border: '#e4e4e7',
    ink: '#09090b',
    ink2: '#3f3f46',
    ink3: '#71717a',
    radius: 12,
    radiusLg: 16,
    shadow: '0 1px 2px rgba(0,0,0,0.04)',
    shadowLg: '0 4px 12px rgba(0,0,0,0.06)',
    cardBlur: 'none',
    fontDisplay: 'Inter',
    fontBody: 'Inter',
  },
  glass: {
    bgBase: '#eadfce',
    surface: 'rgba(255,255,255,0.55)',
    surfaceMobileFallback: 'rgba(255,255,255,0.85)',
    surface2: 'rgba(255,255,255,0.78)',
    border: 'rgba(255,255,255,0.7)',
    ink: '#1c1917',
    ink2: '#44403c',
    ink3: '#78716c',
    radius: 16,
    radiusLg: 20,
    shadow: '0 8px 32px rgba(28,25,23,0.08), inset 0 1px 0 rgba(255,255,255,0.6)',
    shadowLg: '0 14px 32px rgba(168,133,77,0.45), inset 0 1px 0 rgba(255,255,255,0.4)',
    cardBlur: 'blur(20px) saturate(140%)',
    fontDisplay: 'Fraunces',
    fontBody: 'Inter',
  },
  editorial: {
    bgBase: '#f5f3ee',
    surface: '#ffffff',
    surface2: '#ece9e1',
    border: '#0a0a0a',
    borderSoft: '#d6d3c9',
    ink: '#0a0a0a',
    ink2: '#525252',
    ink3: '#a8a29e',
    radius: 4,
    radiusLg: 6,
    shadow: 'none',
    shadowLg: 'none',
    cardBlur: 'none',
    fontDisplay: 'Instrument Serif',
    fontBody: 'Inter',
  },
  classic: {
    bgBase: '#f5f2f2',
    surface: '#ffffff',
    surface2: '#f0eded',
    border: '#dbd9d9',
    ink: '#252527',
    ink2: '#4d4d4d',
    ink3: '#6e6e6e',
    radius: 12,
    radiusLg: 16,
    shadow: 'none',
    shadowLg: '0 4px 12px rgba(0,0,0,0.06)',
    cardBlur: 'none',
    fontDisplay: 'Sora',
    fontBody: 'Inter',
  },
};

// Tone scale formulas mirror devDerive.ts §3 — HSL shifts, not raw -5%/-12%
// percentages. Backend and frontend dev fallback must produce identical hex.
export function deriveTones(brandHex: string, preset: PresetId = 'classic'): ResolvedThemeTokens {
  const rgb = parseHex(brandHex);
  if (!rgb) throw new Error(`Invalid hex: ${brandHex}`);
  const [h, s, l] = rgbToHsl(rgb.r, rgb.g, rgb.b);

  const brand500 = normalizeHex(brandHex)!;
  const brand50 = hslToHex(h, Math.max(s * 0.5, 12), Math.min(l + (95 - l) * 0.92, 97));
  const brand100 = hslToHex(h, Math.max(s * 0.55, 16), Math.min(l + (90 - l) * 0.85, 93));
  const brand600 = hslToHex(h, Math.min(s * 1.05, 100), Math.max(l * 0.86, 18));
  const brand700 = hslToHex(h, Math.min(s * 1.1, 100), Math.max(l * 0.7, 12));

  const surface = PRESET_SURFACES[preset];

  return {
    brand: brand500,
    brand50,
    brand100,
    brand500,
    brand600,
    brand700,
    brandForeground: pickForeground(brand500),
    ...surface,
  };
}
