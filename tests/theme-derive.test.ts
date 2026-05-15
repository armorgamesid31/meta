import { describe, expect, it } from 'vitest';
import {
  contrastRatio,
  deriveTones,
  isBlockedPastel,
  isPresetId,
  normalizeHex,
  parseHex,
  pickForeground,
  relativeLuminance,
  PRESET_DEFAULT_BRAND,
} from '../src/lib/theme/derive.js';

describe('theme/derive', () => {
  describe('parseHex / normalizeHex', () => {
    it('parses 6-char hex', () => {
      expect(parseHex('#F1841F')).toEqual({ r: 0xf1, g: 0x84, b: 0x1f });
      expect(parseHex('#10b981')).toEqual({ r: 0x10, g: 0xb9, b: 0x81 });
    });

    it('rejects malformed hex', () => {
      expect(parseHex('F1841F')).toBeNull();
      expect(parseHex('#F184')).toBeNull();
      expect(parseHex('#GGGGGG')).toBeNull();
      expect(parseHex('not a color')).toBeNull();
    });

    it('normalizes to uppercase', () => {
      expect(normalizeHex('#f1841f')).toBe('#F1841F');
      expect(normalizeHex('  #f1841f  ')).toBe('#F1841F');
      expect(normalizeHex('#bad')).toBeNull();
    });
  });

  describe('isBlockedPastel', () => {
    it('blocks near-white', () => {
      expect(isBlockedPastel('#FFFFFF')).toBe(true);
      expect(isBlockedPastel('#FAFAFA')).toBe(true);
    });

    it('passes saturated brands', () => {
      expect(isBlockedPastel('#10B981')).toBe(false);
      expect(isBlockedPastel('#F1841F')).toBe(false);
      expect(isBlockedPastel('#DC2626')).toBe(false);
    });
  });

  describe('pickForeground', () => {
    it('returns AA-compliant foreground', () => {
      const orangeForeground = pickForeground('#F1841F');
      expect(['#FFFFFF', '#252527']).toContain(orangeForeground);
      expect(contrastRatio(orangeForeground, '#F1841F')).toBeGreaterThanOrEqual(3);
    });

    it('picks dark ink on light backgrounds', () => {
      expect(pickForeground('#FFFFFF')).toBe('#252527');
    });

    it('picks white on dark backgrounds', () => {
      expect(pickForeground('#0A0A0A')).toBe('#FFFFFF');
    });
  });

  describe('relativeLuminance', () => {
    it('computes 0 for black and 1 for white', () => {
      expect(relativeLuminance('#000000')).toBeCloseTo(0, 5);
      expect(relativeLuminance('#FFFFFF')).toBeCloseTo(1, 5);
    });
  });

  describe('deriveTones', () => {
    it('emits 7 brand tones plus surface palette', () => {
      const tokens = deriveTones('#F1841F', 'classic');
      expect(tokens.brand).toBe('#F1841F');
      expect(tokens.brand500).toBe('#F1841F');
      expect(tokens.brand50).toMatch(/^#[0-9A-F]{6}$/);
      expect(tokens.brand100).toMatch(/^#[0-9A-F]{6}$/);
      expect(tokens.brand600).toMatch(/^#[0-9A-F]{6}$/);
      expect(tokens.brand700).toMatch(/^#[0-9A-F]{6}$/);
      expect(['#FFFFFF', '#252527']).toContain(tokens.brandForeground);
      expect(tokens.fontDisplay).toBe('Sora');
      expect(tokens.fontBody).toBe('Inter');
    });

    it('uses preset-specific surface palette', () => {
      const minimal = deriveTones('#10B981', 'minimal');
      const glass = deriveTones('#10B981', 'glass');
      expect(minimal.fontDisplay).toBe('Inter');
      expect(glass.fontDisplay).toBe('Fraunces');
      expect(minimal.cardBlur).toBe('none');
      expect(glass.cardBlur).toContain('blur');
    });

    it('produces deterministic output for same input', () => {
      const a = deriveTones('#10B981', 'minimal');
      const b = deriveTones('#10B981', 'minimal');
      expect(a).toEqual(b);
    });
  });

  describe('isPresetId', () => {
    it('accepts the 4 preset ids', () => {
      expect(isPresetId('minimal')).toBe(true);
      expect(isPresetId('glass')).toBe(true);
      expect(isPresetId('editorial')).toBe(true);
      expect(isPresetId('classic')).toBe(true);
    });

    it('rejects unknown values', () => {
      expect(isPresetId('rainbow')).toBe(false);
      expect(isPresetId('')).toBe(false);
      expect(isPresetId(null)).toBe(false);
      expect(isPresetId(undefined)).toBe(false);
    });
  });

  describe('PRESET_DEFAULT_BRAND', () => {
    it('matches the v0 frontend defaults in the spec', () => {
      expect(PRESET_DEFAULT_BRAND.minimal).toBe('#10B981');
      expect(PRESET_DEFAULT_BRAND.glass).toBe('#D4A574');
      expect(PRESET_DEFAULT_BRAND.editorial).toBe('#DC2626');
      expect(PRESET_DEFAULT_BRAND.classic).toBe('#F1841F');
    });
  });
});
