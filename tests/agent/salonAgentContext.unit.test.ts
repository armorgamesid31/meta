import { describe, it, expect } from 'vitest';
import { __testing } from '../../src/services/salonAgentContext.js';

const { TONE_DIRECTIVES, normalizeTone, buildStyleDirective, buildSalonOneLiner } = __testing;

describe('salonAgentContext — pure logic', () => {
  describe('normalizeTone (Salon.communicationTone enum ↔ agent lowercase)', () => {
    it.each([
      ['FRIENDLY', 'friendly'],
      ['BALANCED', 'balanced'],
      ['PROFESSIONAL', 'professional'],
      ['friendly', 'friendly'],
      ['professional', 'professional'],
      ['balanced', 'balanced'],
    ])('maps %s -> %s', (input, expected) => {
      expect(normalizeTone(input)).toBe(expected);
    });

    it.each([null, undefined, '', 'UNKNOWN', 'casual', 123, {}, []])(
      'falls back to balanced for invalid input: %p',
      (input) => {
        expect(normalizeTone(input as any)).toBe('balanced');
      },
    );
  });

  describe('TONE_DIRECTIVES — content guarantees', () => {
    it('friendly mentions "sen" diye hitap and contains "samimi"', () => {
      expect(TONE_DIRECTIVES.friendly).toMatch(/sen/i);
      expect(TONE_DIRECTIVES.friendly).toMatch(/samimi/i);
    });

    it('balanced mentions Hanım/Bey (mesafeli ama davetkâr)', () => {
      expect(TONE_DIRECTIVES.balanced).toMatch(/Hanım\/Bey/);
    });

    it('professional explicitly forbids emoji and mentions Sayın', () => {
      expect(TONE_DIRECTIVES.professional).toMatch(/Sayın/);
      expect(TONE_DIRECTIVES.professional).toMatch(/Emoji kullanma/i);
    });

    it('all directives are single-line dense (no double newlines, < 350 chars)', () => {
      for (const key of Object.keys(TONE_DIRECTIVES) as Array<keyof typeof TONE_DIRECTIVES>) {
        expect(TONE_DIRECTIVES[key]).not.toMatch(/\n\n/);
        expect(TONE_DIRECTIVES[key].length).toBeLessThan(350);
      }
    });
  });

  describe('buildStyleDirective — composes 5 axes', () => {
    it('emits the answerLength, emoji, booking, handover, disclosure rules', () => {
      const out = buildStyleDirective({
        tone: 'friendly',
        answerLength: 'short',
        emojiUsage: 'normal',
        bookingGuidance: 'high',
        handoverThreshold: 'early',
        aiDisclosure: 'always',
      });
      expect(out).toMatch(/1-2 kısa cümle/);
      expect(out).toMatch(/1-2 emoji uygun/);
      expect(out).toMatch(/proaktif/);
      expect(out).toMatch(/Belirsizlik/);
      expect(out).toMatch(/AI asistan olduğunu belirt/);
    });

    it('different settings produce different strings (no static leak)', () => {
      const a = buildStyleDirective({
        tone: 'balanced',
        answerLength: 'short',
        emojiUsage: 'off',
        bookingGuidance: 'low',
        handoverThreshold: 'late',
        aiDisclosure: 'never',
      });
      const b = buildStyleDirective({
        tone: 'balanced',
        answerLength: 'detailed',
        emojiUsage: 'normal',
        bookingGuidance: 'high',
        handoverThreshold: 'early',
        aiDisclosure: 'always',
      });
      expect(a).not.toBe(b);
    });
  });

  describe('buildSalonOneLiner', () => {
    it('formats workStartHour/workEndHour as HH:00–HH:00', () => {
      const out = buildSalonOneLiner({
        salonId: 1,
        name: 'Bella Salon',
        city: 'İstanbul',
        district: 'Beşiktaş',
        address: null,
        googleMapsUrl: null,
        instagramUrl: null,
        whatsappPhone: null,
        tagline: null,
        about: null,
        timezone: 'Europe/Istanbul',
        workStartHour: 9,
        workEndHour: 19,
        slotInterval: 30,
        workingDays: null,
        commonQuestions: null,
      });
      expect(out).toMatch(/Salon: Bella Salon/);
      expect(out).toMatch(/Beşiktaş, İstanbul/);
      expect(out).toMatch(/09:00–19:00/);
      expect(out).toMatch(/Europe\/Istanbul/);
    });

    it('survives missing city/district', () => {
      const out = buildSalonOneLiner({
        salonId: 1,
        name: 'X',
        city: null,
        district: null,
        address: null,
        googleMapsUrl: null,
        instagramUrl: null,
        whatsappPhone: null,
        tagline: null,
        about: null,
        timezone: 'Europe/Istanbul',
        workStartHour: 10,
        workEndHour: 22,
        slotInterval: 30,
        workingDays: null,
        commonQuestions: null,
      });
      expect(out).toMatch(/Salon: X/);
      expect(out).toMatch(/10:00–22:00/);
      expect(out).not.toMatch(/Konum:/);
    });
  });
});
