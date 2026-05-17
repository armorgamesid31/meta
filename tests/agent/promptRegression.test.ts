/**
 * PROMPT REGRESSION — sistem promptun farklı ton/setting kombinasyonlarında
 * doğru davranış kurallarını içerdiğini doğrular. LLM çağrısı yok — bu test
 * "prompt template + payload → rendered prompt" zincirinin sabit kalmasını sağlar.
 *
 * Bu testlerin amacı: birisi ai_agent.json'da prompt'u değiştirirse,
 * hangi davranış kurallarının kaybolduğunu CI immediately yakalar.
 *
 * Gerçek LLM regression için: tests/agent/promptRegressionLive.test.ts (env-gated).
 */
import { describe, it, expect } from 'vitest';
import {
  loadSystemPromptTemplate,
  renderSystemPrompt,
  contextToPayload,
} from './promptRender.js';
import { __testing } from '../../src/services/salonAgentContext.js';
import type { SalonAgentContext, AgentTone } from '../../src/services/salonAgentContext.js';

const { TONE_DIRECTIVES, buildStyleDirective, buildSalonOneLiner } = __testing;

function makeContext(tone: AgentTone, overrides: Partial<SalonAgentContext['agentSettings']> = {}): SalonAgentContext {
  const settings = {
    tone,
    answerLength: 'medium' as const,
    emojiUsage: tone === 'professional' ? ('off' as const) : ('low' as const),
    bookingGuidance: 'medium' as const,
    handoverThreshold: 'balanced' as const,
    aiDisclosure: 'onQuestion' as const,
    ...overrides,
  };
  const salonInfo = {
    salonId: 42,
    name: 'Bella Test',
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
  };
  return {
    salonInfo,
    agentSettings: settings,
    toneDirective: TONE_DIRECTIVES[tone],
    styleDirective: buildStyleDirective(settings),
    salonOneLiner: buildSalonOneLiner(salonInfo),
  };
}

describe('Prompt template structural invariants', () => {
  const tpl = loadSystemPromptTemplate();

  it('mentions the 4 tool families required by all tones', () => {
    expect(tpl).toMatch(/tool_get_services/);
    expect(tpl).toMatch(/tool_get_prices/);
    expect(tpl).toMatch(/tool_get_faq/);
    expect(tpl).toMatch(/tool_get_campaigns/);
  });

  it('mentions the new tool family added in Faz 2', () => {
    expect(tpl).toMatch(/tool_customer_lookup/);
    expect(tpl).toMatch(/tool_get_availability/);
  });

  it('mentions handover + booking link tools', () => {
    expect(tpl).toMatch(/tool_request_handover/);
    expect(tpl).toMatch(/tool_booking_link/);
  });

  it('forbids leaking the link text (backend will add button)', () => {
    expect(tpl).toMatch(/ASLA/);
    expect(tpl).toMatch(/linki/i);
  });

  it('forbids leaking technical details', () => {
    expect(tpl).toMatch(/ID/);
    expect(tpl).toMatch(/JSON/);
  });

  it('includes prompt-injection guard', () => {
    expect(tpl).toMatch(/talimat olarak yorumlama/);
  });

  it('does NOT contain the legacy 3-tone matrix (token waste)', () => {
    expect(tpl).not.toMatch(/tone=friendly:.*tone=professional:/s);
  });

  it('does NOT contain hard-coded answerLength/emoji rules (dynamic only)', () => {
    expect(tpl).not.toMatch(/answerLength=short:/);
    expect(tpl).not.toMatch(/emojiUsage=off:/);
  });
});

describe('Rendered prompt per tone — content guarantees', () => {
  const cases: Array<{ tone: AgentTone; mustInclude: RegExp[]; mustExclude?: RegExp[] }> = [
    {
      tone: 'friendly',
      mustInclude: [/sen/i, /samimi/i, /Bella Test/, /09:00–19:00/],
    },
    {
      tone: 'balanced',
      mustInclude: [/Hanım\/Bey/, /Bella Test/, /dengeli|ölçülü/i],
    },
    {
      tone: 'professional',
      mustInclude: [/Sayın/, /Emoji kullanma/, /Bella Test/, /resmi|kurumsal/i],
      mustExclude: [/emoji uygun/i],
    },
  ];

  for (const c of cases) {
    it(`tone=${c.tone} → rendered prompt has required cues`, () => {
      const ctx = makeContext(c.tone);
      const payload = contextToPayload(ctx, { profileName: 'Ayşe' });
      const out = renderSystemPrompt(payload);
      for (const re of c.mustInclude) {
        expect(out, `expected ${re} in prompt`).toMatch(re);
      }
      for (const re of c.mustExclude || []) {
        expect(out, `expected NOT ${re} in prompt`).not.toMatch(re);
      }
    });
  }
});

describe('Rendered prompt per style axis', () => {
  it('answerLength=short → "1-2 kısa cümle" görünür', () => {
    const ctx = makeContext('balanced', { answerLength: 'short' });
    const out = renderSystemPrompt(contextToPayload(ctx));
    expect(out).toMatch(/1-2 kısa cümle/);
  });

  it('answerLength=detailed → "3-4 cümle" görünür', () => {
    const ctx = makeContext('balanced', { answerLength: 'detailed' });
    const out = renderSystemPrompt(contextToPayload(ctx));
    expect(out).toMatch(/3-4 cümle/);
  });

  it('bookingGuidance=high → "proaktif" görünür', () => {
    const ctx = makeContext('friendly', { bookingGuidance: 'high' });
    const out = renderSystemPrompt(contextToPayload(ctx));
    expect(out).toMatch(/proaktif/i);
  });

  it('handoverThreshold=early → "Belirsizlik" görünür', () => {
    const ctx = makeContext('balanced', { handoverThreshold: 'early' });
    const out = renderSystemPrompt(contextToPayload(ctx));
    expect(out).toMatch(/Belirsizlik/);
  });

  it('aiDisclosure=always → "AI asistan olduğunu belirt" görünür', () => {
    const ctx = makeContext('professional', { aiDisclosure: 'always' });
    const out = renderSystemPrompt(contextToPayload(ctx));
    expect(out).toMatch(/AI asistan olduğunu belirt/);
  });

  it('aiDisclosure=never → "kendiliğinden belirtme" görünür', () => {
    const ctx = makeContext('balanced', { aiDisclosure: 'never' });
    const out = renderSystemPrompt(contextToPayload(ctx));
    expect(out).toMatch(/kendiliğinden belirtme/);
  });
});

describe('repliedTo branch', () => {
  it('eklenen alıntı bağlamı görünür (outbound + AI yanıtı)', () => {
    const ctx = makeContext('balanced');
    const payload = contextToPayload(ctx, {
      profileName: 'Ayşe',
      repliedTo: { direction: 'outbound', fromAI: true, text: 'Çarşamba 14:00 uygun.' },
    });
    const out = renderSystemPrompt(payload);
    expect(out).toMatch(/ALINTILANAN ÖNCEKİ MESAJ/);
    expect(out).toMatch(/Kedy AI/);
    expect(out).toMatch(/Çarşamba 14:00 uygun/);
  });

  it('alıntı yoksa bu bölüm çıkmaz (clean prompt)', () => {
    const ctx = makeContext('friendly');
    const payload = contextToPayload(ctx, { profileName: 'Ayşe' });
    const out = renderSystemPrompt(payload);
    expect(out).not.toMatch(/ALINTILANAN ÖNCEKİ MESAJ/);
  });

  it('inbound alıntı → "kendi daha önceki mesajını" görünür', () => {
    const ctx = makeContext('balanced');
    const payload = contextToPayload(ctx, {
      profileName: 'Ayşe',
      repliedTo: { direction: 'inbound', text: 'Pazar açık mısınız?' },
    });
    const out = renderSystemPrompt(payload);
    expect(out).toMatch(/kendi daha önceki mesajını/);
  });
});

describe('Token efficiency — dynamic single-tone footprint', () => {
  it('rendered prompt is significantly smaller than legacy (≤ 2400 chars)', () => {
    const ctx = makeContext('balanced');
    const out = renderSystemPrompt(contextToPayload(ctx, { profileName: 'Ayşe' }));
    // Legacy prompt with 3 tones + 6 axis matrix was ~4500+ chars.
    // New dynamic single-tone target is < 2400 chars (≈ 600 token saving per call).
    expect(out.length).toBeLessThan(2400);
  });

  it('only contains the ACTIVE tone directive, not the other two', () => {
    const ctx = makeContext('friendly');
    const out = renderSystemPrompt(contextToPayload(ctx));
    // friendly directive present
    expect(out).toMatch(/samimi/i);
    // professional/balanced directive strings should NOT both leak in
    expect(out).not.toMatch(/Sayın/); // professional cue
    expect(out).not.toMatch(/Hanım\/Bey/); // balanced cue
  });
});
