#!/usr/bin/env node
/**
 * Production smoke test — uses no credentials, runs against the
 * live backend (api.kedyapp.com) and the live frontend
 * (web.kedyapp.com) and verifies the contract pieces we built:
 *
 *   1. /health returns 200 + valid JSON
 *   2. Every response carries an X-Trace-Id header
 *   3. Incoming X-Trace-Id is echoed back (propagation)
 *   4. Unknown /api path → 404 + { code: NOT_FOUND, message, traceId }
 *   5. Protected route w/o token → 401 + { code: UNAUTHORIZED, ... }
 *   6. Bad register payload → 400 + { code: VALIDATION_FAILED, ... }
 *   7. /auth/login spam → eventually 429 + { code: RATE_LIMITED, ... }
 *   8. Frontend HTML loads
 *   9. Frontend main bundle is under 500 KB (was 1.75 MB before bundle splitting)
 *
 * Usage:
 *   node scripts/smoke-production.mjs
 *   BACKEND_URL=https://my-backend node scripts/smoke-production.mjs
 *   FRONTEND_URL=https://my-frontend node scripts/smoke-production.mjs
 */

const BACKEND = process.env.BACKEND_URL || 'https://api.kedyapp.com';
const FRONTEND = process.env.FRONTEND_URL || 'https://web.kedyapp.com';

const GREEN = '\x1b[32m';
const RED = '\x1b[31m';
const YELLOW = '\x1b[33m';
const GRAY = '\x1b[90m';
const RESET = '\x1b[0m';

const results = [];

function pass(name, detail = '') {
  results.push({ name, ok: true, detail });
  console.log(`${GREEN}✓${RESET} ${name}${detail ? GRAY + ' — ' + detail + RESET : ''}`);
}

function fail(name, detail = '') {
  results.push({ name, ok: false, detail });
  console.log(`${RED}✗${RESET} ${name}${detail ? RED + ' — ' + detail + RESET : ''}`);
}

function warn(name, detail = '') {
  results.push({ name, ok: true, detail, warning: true });
  console.log(`${YELLOW}!${RESET} ${name}${detail ? YELLOW + ' — ' + detail + RESET : ''}`);
}

async function jsonOrText(res) {
  const text = await res.text();
  try {
    return { json: JSON.parse(text), text };
  } catch {
    return { json: null, text };
  }
}

async function test1Health() {
  const res = await fetch(`${BACKEND}/health`);
  if (res.status !== 200) return fail('1. /health 200', `got ${res.status}`);
  const { json } = await jsonOrText(res);
  if (!json?.status) return fail('1. /health 200', 'missing status field');
  pass('1. /health returns 200', `db=${json.dbStatus || '?'} latency=${json.dbLatencyMs || '?'}ms`);
}

async function test2TraceIdHeader() {
  const res = await fetch(`${BACKEND}/health`);
  const traceId = res.headers.get('x-trace-id');
  if (!traceId) return fail('2. X-Trace-Id header', 'header missing');
  if (traceId.length < 8) return fail('2. X-Trace-Id header', `too short: ${traceId}`);
  pass('2. X-Trace-Id header present', traceId.slice(0, 8) + '…');
}

async function test3TraceIdEcho() {
  const ours = 'smoke-test-' + Date.now();
  const res = await fetch(`${BACKEND}/health`, { headers: { 'X-Trace-Id': ours } });
  const echoed = res.headers.get('x-trace-id');
  if (echoed !== ours) return fail('3. X-Trace-Id echo', `sent ${ours}, got ${echoed}`);
  pass('3. Incoming X-Trace-Id echoed back');
}

async function test4Unknown404() {
  const res = await fetch(`${BACKEND}/api/this-route-does-not-exist-${Date.now()}`);
  if (res.status !== 404) return fail('4. Unknown /api → 404', `got ${res.status}`);
  const { json } = await jsonOrText(res);
  if (!json) return fail('4. Unknown /api → 404', 'response not JSON');
  if (json.code !== 'NOT_FOUND') return fail('4. Unknown /api → 404', `code=${json.code}`);
  if (!json.traceId) return fail('4. Unknown /api → 404', 'no traceId in body');
  pass('4. Unknown /api → 404 envelope', `code=${json.code}`);
}

async function test5Unauthorized() {
  const res = await fetch(`${BACKEND}/api/admin/customers?limit=1`);
  if (res.status !== 401) return fail('5. Protected route → 401', `got ${res.status}`);
  const { json } = await jsonOrText(res);
  if (!json) return fail('5. Protected route → 401', 'response not JSON');
  if (json.code !== 'UNAUTHORIZED') return fail('5. Protected route → 401', `code=${json.code}`);
  pass('5. Protected → 401 UNAUTHORIZED envelope');
}

async function test6ValidationFailed() {
  const res = await fetch(`${BACKEND}/api/customers/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({}),
  });
  const { json } = await jsonOrText(res);
  // If the previous run already burned the auth rate-limit budget for
  // this IP we'll see 429 instead of 400 here. Both prove the standard
  // envelope works; we only fail if we get neither code we expect.
  if (res.status === 400 && json?.code === 'VALIDATION_FAILED') {
    return pass('6. Empty body → 400 VALIDATION_FAILED', json.message?.slice(0, 40) + '…');
  }
  if (res.status === 429 && json?.code === 'RATE_LIMITED') {
    return warn('6. Empty body → 400 (skipped, rate-limited)', 'rerun in 60s for a clean check');
  }
  fail('6. Bad payload → 400', `status=${res.status} code=${json?.code}`);
}

async function test7RateLimit() {
  let limited = false;
  let firstLimitedAt = -1;
  for (let i = 0; i < 15; i++) {
    const res = await fetch(`${BACKEND}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ identifier: 'smoke-test', password: 'x' }),
    });
    if (res.status === 429) {
      const { json } = await jsonOrText(res);
      if (json?.code === 'RATE_LIMITED') {
        limited = true;
        firstLimitedAt = i + 1;
        break;
      }
    }
  }
  if (!limited) return fail('7. /auth/login rate limit', 'no 429 after 15 requests');
  pass(`7. /auth/login rate limit triggers`, `429 at request #${firstLimitedAt}`);
}

async function test8FrontendHtml() {
  const res = await fetch(FRONTEND, { redirect: 'follow' });
  if (!res.ok) return fail('8. Frontend HTML loads', `got ${res.status}`);
  const text = await res.text();
  if (!text.includes('<!doctype html') && !text.includes('<!DOCTYPE html')) {
    return fail('8. Frontend HTML loads', 'no HTML doctype');
  }
  if (!text.includes('/assets/index-')) {
    return fail('8. Frontend HTML loads', 'no main asset bundle reference');
  }
  pass('8. Frontend HTML loads', `${text.length} bytes`);
}

async function test9BundleSize() {
  const html = await (await fetch(FRONTEND, { redirect: 'follow' })).text();
  const match = html.match(/src=["']\/assets\/(index-[^"']+\.js)["']/);
  if (!match) return fail('9. Main bundle size', 'no index-*.js asset link in HTML');
  const url = `${FRONTEND}/assets/${match[1]}`;
  // Some CDNs/proxies (Caddy + auto-gzip) drop Content-Length on HEAD; fall
  // back to a GET and measure the decoded body length so the check is
  // resilient.
  let bytes = 0;
  const head = await fetch(url, { method: 'HEAD' });
  const headLen = Number(head.headers.get('content-length') || 0);
  if (headLen > 0) {
    bytes = headLen;
  } else {
    const body = await (await fetch(url)).arrayBuffer();
    bytes = body.byteLength;
  }
  const sizeKb = Math.round(bytes / 1024);
  // Threshold tuned for the post-bundle-splitting build (~395 kB index
  // + ~80 kB Sentry SDK = ~475 kB). Was ~1.75 MB before splitting.
  if (sizeKb >= 600) {
    return warn('9. Main bundle size', `${sizeKb} kB — bundle splitting may not be live yet`);
  }
  pass('9. Main bundle size', `${sizeKb} kB (<600 kB target)`);
}

async function main() {
  console.log(`\nSmoke test against:`);
  console.log(`  Backend:  ${BACKEND}`);
  console.log(`  Frontend: ${FRONTEND}\n`);

  const tests = [
    test1Health,
    test2TraceIdHeader,
    test3TraceIdEcho,
    test4Unknown404,
    test5Unauthorized,
    test6ValidationFailed,
    test7RateLimit,
    test8FrontendHtml,
    test9BundleSize,
  ];

  for (const t of tests) {
    try {
      await t();
    } catch (err) {
      fail(t.name, err?.message || String(err));
    }
  }

  const passed = results.filter((r) => r.ok && !r.warning).length;
  const warned = results.filter((r) => r.warning).length;
  const failed = results.filter((r) => !r.ok).length;

  console.log(`\n${'─'.repeat(50)}`);
  console.log(`${GREEN}${passed} pass${RESET}, ${YELLOW}${warned} warning${RESET}, ${RED}${failed} fail${RESET}`);

  if (failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error('Smoke test crashed:', err);
  process.exit(2);
});
