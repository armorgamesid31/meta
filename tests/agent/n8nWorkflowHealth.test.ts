/**
 * n8n ai_agent.json workflow'unun YAPISAL sağlığını kanıtlar.
 * UI'da elle değişiklik yapılırsa veya birisi yanlışlıkla buffer'ı tekrar
 * disable ederse / tool node silinirse / API key hard-code'a dönerse,
 * CI bunu hemen yakalar.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

let workflow: any;
let nodes: any[];
let connections: Record<string, any>;

beforeAll(() => {
  const raw = fs.readFileSync(
    path.resolve(__dirname, '../../n8n/workflows/ai_agent.json'),
    'utf8',
  );
  workflow = JSON.parse(raw);
  nodes = workflow.nodes;
  connections = workflow.connections;
});

function nodeByName(name: string) {
  return nodes.find((n) => n.name === name);
}

describe('Workflow JSON shape', () => {
  it('is parseable and has nodes + connections', () => {
    expect(Array.isArray(nodes)).toBe(true);
    expect(typeof connections).toBe('object');
    expect(nodes.length).toBeGreaterThan(15);
  });
});

describe('Critical nodes present', () => {
  const required = [
    'webhook',
    'If',
    '1. Hemen Mesajı Kaydet1',
    '3. Message Type Switch',
    '4a. Text Mesajı İşle',
    '4b. Fetch Image Media',
    '4e. Fetch Audio Media',
    '4h. Fetch Video Media',
    '4j. Fetch Document Media',
    '4l. Interactive Handler',
    '6. Son Buffer (10s)',
    '5. İşlenmiş Durumu Güncelle',
    'AI Agent Single',
    'OpenRouter Chat Model',
    'Memory',
    'AI Output -> Backend',
    'Outbound Error Log',
  ];
  it.each(required)('node exists: %s', (name) => {
    expect(nodeByName(name), `missing node ${name}`).toBeDefined();
  });
});

describe('Buffer node is ENABLED (regression: was disabled in old version)', () => {
  it('6. Son Buffer (10s) has no disabled:true', () => {
    const node = nodeByName('6. Son Buffer (10s)');
    expect(node).toBeDefined();
    expect(node.disabled).not.toBe(true);
  });

  it('buffer wait amount is 10s (not 15 or 0)', () => {
    const node = nodeByName('6. Son Buffer (10s)');
    expect(node.parameters?.amount).toBe(10);
  });
});

describe('Message Type Switch covers ALL message kinds', () => {
  it('switch has 6 rules (text/image/audio/video/document/interactive)', () => {
    const node = nodeByName('3. Message Type Switch');
    const values = node.parameters?.rules?.values || [];
    const outputKeys = values.map((v: any) => v.outputKey);
    expect(outputKeys).toEqual(
      expect.arrayContaining(['text', 'image', 'audio', 'video', 'document', 'interactive']),
    );
  });

  it('switch output positions are wired to the right processor nodes', () => {
    const sw = connections['3. Message Type Switch']?.main;
    // [text, image, audio, video, document, interactive]
    expect(sw).toHaveLength(6);
    expect(sw[0][0].node).toBe('4a. Text Mesajı İşle');
    expect(sw[1][0].node).toBe('4b. Fetch Image Media');
    expect(sw[2][0].node).toBe('4e. Fetch Audio Media');
    expect(sw[3][0].node).toBe('4h. Fetch Video Media');
    expect(sw[4][0].node).toBe('4j. Fetch Document Media');
    expect(sw[5][0].node).toBe('4l. Interactive Handler');
  });
});

describe('All tools are wired into AI Agent Single', () => {
  const tools = [
    'tool_get_services',
    'tool_get_prices',
    'tool_get_campaigns',
    'tool_get_faq',
    'tool_request_handover',
    'tool_booking_link',
    'tool_get_salon_context',
    'tool_customer_lookup',
    'tool_get_availability',
  ];
  it.each(tools)('tool node exists: %s', (name) => {
    expect(nodeByName(name)).toBeDefined();
  });
  it.each(tools)('tool %s connected to AI Agent Single via ai_tool', (name) => {
    const conn = connections[name]?.ai_tool;
    expect(conn, `${name} missing ai_tool connection`).toBeDefined();
    const targets = conn[0].map((c: any) => c.node);
    expect(targets).toContain('AI Agent Single');
  });
});

describe('Outbound resilience', () => {
  it('AI Output -> Backend has retry + onError continueErrorOutput', () => {
    const node = nodeByName('AI Output -> Backend');
    expect(node.retryOnFail).toBe(true);
    expect(node.maxTries).toBeGreaterThanOrEqual(2);
    expect(node.waitBetweenTries).toBeGreaterThan(0);
    expect(node.onError).toBe('continueErrorOutput');
  });

  it('Outbound error path goes to Outbound Error Log', () => {
    const outConn = connections['AI Output -> Backend'];
    expect(outConn?.error).toBeDefined();
    const errTargets = outConn.error[0].map((c: any) => c.node);
    expect(errTargets).toContain('Outbound Error Log');
  });
});

describe('Security: no hard-coded API keys in HTTP nodes', () => {
  it('no node header carries the legacy plaintext keys', () => {
    const json = JSON.stringify(workflow);
    expect(json).not.toMatch(/4c4ec9dd02994c9fa27b2b316631f22fd1f04455a54351b8575a60d6a99756fd/);
    // The webhook-ingress auth check key (line 669) was also replaced.
    const headerHardcoded = nodes.some((n) => {
      const params = n.parameters?.headerParameters?.parameters || [];
      return params.some(
        (p: any) =>
          p.name === 'x-internal-api-key' &&
          typeof p.value === 'string' &&
          !p.value.includes('$env'),
      );
    });
    expect(headerHardcoded, 'a node still has a literal x-internal-api-key value').toBe(false);
  });
});

describe('AI Agent system prompt uses dynamic single-tone payload', () => {
  it('systemMessage references body.toneDirective (not raw tone string)', () => {
    const node = nodeByName('AI Agent Single');
    const sm = node.parameters?.options?.systemMessage as string;
    expect(sm).toBeDefined();
    expect(sm).toMatch(/\$json\.body\?\.toneDirective/);
    expect(sm).toMatch(/\$json\.body\?\.styleDirective/);
    expect(sm).toMatch(/\$json\.body\?\.salonOneLiner/);
  });

  it('systemMessage does NOT enumerate all 3 tones inline (regression)', () => {
    const node = nodeByName('AI Agent Single');
    const sm = node.parameters?.options?.systemMessage as string;
    // Legacy had blocks like "tone=friendly: sıcak..." for all three.
    const tonelines = sm.match(/tone=(friendly|professional|balanced):/g) || [];
    expect(tonelines.length).toBe(0);
  });

  it('LLM model is set to Gemini Flash (cost-effective for high volume)', () => {
    const llm = nodeByName('OpenRouter Chat Model');
    expect(llm.parameters?.model).toMatch(/gemini.*flash/i);
  });

  it('memory buffer window is at least 8 turns', () => {
    const mem = nodeByName('Memory');
    expect(mem.parameters?.contextWindowLength).toBeGreaterThanOrEqual(8);
  });

  it('AI Agent has retry config', () => {
    const node = nodeByName('AI Agent Single');
    expect(node.retryOnFail).toBe(true);
  });
});

describe('Webhook auth check uses env var, not hard-coded token', () => {
  it('If node rightValue references $env', () => {
    const ifNode = nodeByName('If');
    const conds = ifNode.parameters?.conditions?.conditions || [];
    const apiKeyCheck = conds.find(
      (c: any) => typeof c.leftValue === 'string' && c.leftValue.includes('x-internal-api-key'),
    );
    expect(apiKeyCheck, 'webhook auth condition missing').toBeDefined();
    expect(apiKeyCheck.rightValue).toMatch(/\$env/);
  });
});
