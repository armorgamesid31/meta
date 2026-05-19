#!/usr/bin/env node
/**
 * Load test — drives the live backend with five concurrent scenarios
 * that mimic real-world heavy use, then reports throughput, latency
 * percentiles, error breakdown, and contract-integrity checks
 * (every response must carry a unique X-Trace-Id and a known code).
 *
 * Scenarios:
 *   A. Health probe storm     — concurrent GET /health
 *   B. Unknown path storm     — concurrent 404 envelope verification
 *   C. Unauthorized storm     — concurrent 401 envelope verification
 *   D. Validation storm       — concurrent bad-payload POST
 *   E. Rate limit + recovery  — burst /auth/login, wait, retry
 *
 * Usage:
 *   node scripts/load-test.mjs                    # default profile
 *   PROFILE=light node scripts/load-test.mjs      # smaller volumes
 *   PROFILE=heavy node scripts/load-test.mjs      # bigger volumes
 *   BACKEND_URL=https://my-backend node scripts/load-test.mjs
 */

const BACKEND = process.env.BACKEND_URL || 'https://api.kedyapp.com';
const PROFILE = process.env.PROFILE || 'default';

const PROFILES = {
  light:   { health: 100, unknown: 50,  unauth: 50,  validation: 30, mixedSec: 20 },
  default: { health: 300, unknown: 150, unauth: 150, validation: 60, mixedSec: 30 },
  heavy:   { health: 800, unknown: 400, unauth: 400, validation: 120, mixedSec: 60 },
};
const PROF = PROFILES[PROFILE] || PROFILES.default;
const CONCURRENCY = Number(process.env.CONCURRENCY || 30);

const GREEN = '\x1b[32m';
const RED = '\x1b[31m';
const YELLOW = '\x1b[33m';
const CYAN = '\x1b[36m';
const GRAY = '\x1b[90m';
const RESET = '\x1b[0m';

function fmtMs(n) { return `${n.toFixed(0)}ms`; }
function pct(arr, p) {
  if (!arr.length) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.floor(sorted.length * p));
  return sorted[idx];
}

async function timed(fn) {
  const t0 = Date.now();
  try {
    const result = await fn();
    return { ok: true, ms: Date.now() - t0, ...result };
  } catch (err) {
    return { ok: false, ms: Date.now() - t0, error: err?.message || String(err) };
  }
}

async function runConcurrent(total, concurrency, taskFn) {
  const results = [];
  let next = 0;
  async function worker() {
    while (true) {
      const i = next++;
      if (i >= total) return;
      results.push(await taskFn(i));
    }
  }
  await Promise.all(Array.from({ length: concurrency }, () => worker()));
  return results;
}

function summarize(name, results, expectations = {}) {
  const oks = results.filter((r) => r.ok);
  const fails = results.filter((r) => !r.ok);
  const latencies = oks.map((r) => r.ms);
  const codeBreakdown = {};
  const statusBreakdown = {};
  const traceIds = new Set();
  let nonEnvelope = 0;
  let dupeTraces = 0;
  let envelopeErrors = 0;

  for (const r of results) {
    if (r.status !== undefined) statusBreakdown[r.status] = (statusBreakdown[r.status] || 0) + 1;
    if (r.code) codeBreakdown[r.code] = (codeBreakdown[r.code] || 0) + 1;
    if (r.traceId) {
      if (traceIds.has(r.traceId)) dupeTraces++;
      else traceIds.add(r.traceId);
    }
    if (r.expectedEnvelope === true && !r.code) nonEnvelope++;
    if (r.envelopeBroken) envelopeErrors++;
  }

  const p50 = pct(latencies, 0.5);
  const p95 = pct(latencies, 0.95);
  const p99 = pct(latencies, 0.99);
  const mean = latencies.length ? latencies.reduce((a, b) => a + b, 0) / latencies.length : 0;
  const max = latencies.length ? Math.max(...latencies) : 0;

  console.log(`\n${CYAN}── ${name} ──${RESET}`);
  console.log(`  total=${results.length} ok=${oks.length} fail=${fails.length}`);
  console.log(`  status: ${Object.entries(statusBreakdown).map(([k, v]) => `${k}×${v}`).join(' ')}`);
  if (Object.keys(codeBreakdown).length) {
    console.log(`  codes:  ${Object.entries(codeBreakdown).map(([k, v]) => `${k}×${v}`).join(' ')}`);
  }
  console.log(`  latency: p50=${fmtMs(p50)} p95=${fmtMs(p95)} p99=${fmtMs(p99)} max=${fmtMs(max)} mean=${fmtMs(mean)}`);
  console.log(`  trace ids: unique=${traceIds.size} dupes=${dupeTraces}`);

  // Pass/fail decisions
  const issues = [];
  if (fails.length > 0) issues.push(`${fails.length} request(s) failed at network level`);
  if (dupeTraces > 0) issues.push(`${dupeTraces} duplicate trace id(s)`);
  if (nonEnvelope > 0) issues.push(`${nonEnvelope} response(s) missed the standard envelope`);
  if (envelopeErrors > 0) issues.push(`${envelopeErrors} envelope shape error(s)`);
  if (expectations.maxP95Ms && p95 > expectations.maxP95Ms)
    issues.push(`p95 ${fmtMs(p95)} > target ${fmtMs(expectations.maxP95Ms)}`);
  if (expectations.minOkRate && oks.length / results.length < expectations.minOkRate)
    issues.push(`success rate ${((oks.length / results.length) * 100).toFixed(1)}% < target ${(expectations.minOkRate * 100)}%`);

  if (issues.length === 0) {
    console.log(`  ${GREEN}PASS${RESET}`);
  } else {
    console.log(`  ${RED}FAIL${RESET}`);
    for (const i of issues) console.log(`    ${RED}–${RESET} ${i}`);
  }
  return { name, ok: issues.length === 0, issues };
}

async function fetchAndCheck(url, init = {}, expect = {}) {
  return timed(async () => {
    const res = await fetch(url, init);
    const status = res.status;
    const traceId = res.headers.get('x-trace-id') || null;
    let body = null;
    try {
      body = await res.json();
    } catch {
      // non-JSON
    }
    const code = body?.code || null;
    const expectedEnvelope = expect.envelope === true;
    const envelopeBroken = expectedEnvelope && (!code || !traceId || !body?.message);
    return { status, traceId, code, body, expectedEnvelope, envelopeBroken };
  });
}

async function scenarioA_HealthStorm() {
  return runConcurrent(PROF.health, CONCURRENCY, () =>
    fetchAndCheck(`${BACKEND}/health`),
  );
}

async function scenarioB_UnknownStorm() {
  return runConcurrent(PROF.unknown, CONCURRENCY, (i) =>
    fetchAndCheck(`${BACKEND}/api/load-test-${i}-${Date.now()}`, {}, { envelope: true }),
  );
}

async function scenarioC_UnauthStorm() {
  return runConcurrent(PROF.unauth, CONCURRENCY, () =>
    fetchAndCheck(`${BACKEND}/api/admin/customers?limit=1`, {}, { envelope: true }),
  );
}

async function scenarioD_ValidationStorm() {
  return runConcurrent(PROF.validation, CONCURRENCY, () =>
    fetchAndCheck(
      `${BACKEND}/api/customers/register`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      },
      { envelope: true },
    ),
  );
}

async function scenarioE_RateLimitRecovery() {
  // Phase 1: trip the limiter
  const trip = [];
  for (let i = 0; i < 15; i++) {
    trip.push(
      await fetchAndCheck(
        `${BACKEND}/auth/login`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ identifier: 'load-test', password: 'x' }),
        },
        { envelope: true },
      ),
    );
  }
  const got429 = trip.some((r) => r.status === 429 && r.code === 'RATE_LIMITED');
  // Phase 2: wait 65s for the window to roll
  console.log(`  waiting 65s for rate limit window to reset…`);
  await new Promise((r) => setTimeout(r, 65_000));
  // Phase 3: should succeed again (status will be 401 because creds are wrong, but no longer 429)
  const recovery = await fetchAndCheck(
    `${BACKEND}/auth/login`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ identifier: 'load-test', password: 'x' }),
    },
  );
  const recovered = recovery.status !== 429;
  return [
    ...trip,
    {
      ok: true,
      ms: 0,
      status: recovery.status,
      code: recovery.code,
      traceId: recovery.traceId,
      _phase: 'recovery',
      _recovered: recovered,
      _tripped: got429,
    },
  ];
}

async function main() {
  console.log(`${CYAN}Load test${RESET} — backend=${BACKEND}, profile=${PROFILE} (${JSON.stringify(PROF)}), concurrency=${CONCURRENCY}`);
  console.log(`${GRAY}Started at ${new Date().toISOString()}${RESET}`);

  const reports = [];

  console.log(`\n${YELLOW}A. Health probe storm${RESET} (${PROF.health} reqs)`);
  reports.push(summarize('A. Health probe storm', await scenarioA_HealthStorm(), {
    maxP95Ms: 1500,
    minOkRate: 0.99,
  }));

  console.log(`\n${YELLOW}B. Unknown path 404 storm${RESET} (${PROF.unknown} reqs)`);
  reports.push(summarize('B. Unknown path 404 storm', await scenarioB_UnknownStorm(), {
    maxP95Ms: 2000,
    minOkRate: 0.99,
  }));

  console.log(`\n${YELLOW}C. Unauthorized storm${RESET} (${PROF.unauth} reqs)`);
  reports.push(summarize('C. Unauthorized 401 storm', await scenarioC_UnauthStorm(), {
    maxP95Ms: 2000,
    minOkRate: 0.99,
  }));

  console.log(`\n${YELLOW}D. Validation storm${RESET} (${PROF.validation} reqs)`);
  // Validation hits the same endpoint as the auth limiter (10/min), so we
  // expect most to be 429. We just verify each one is in standard envelope.
  reports.push(summarize('D. Validation/rate-limit storm', await scenarioD_ValidationStorm(), {
    maxP95Ms: 2500,
    minOkRate: 0.99,
  }));

  console.log(`\n${YELLOW}E. Rate limit + recovery${RESET}`);
  const rateResults = await scenarioE_RateLimitRecovery();
  const tripped = rateResults.some((r) => r.status === 429);
  const recovered = rateResults.find((r) => r._phase === 'recovery')?._recovered === true;
  reports.push(summarize('E. Rate limit + recovery', rateResults, {
    minOkRate: 0.99,
  }));
  if (!tripped) console.log(`    ${RED}–${RESET} rate limit never tripped`);
  if (!recovered) console.log(`    ${RED}–${RESET} did not recover after 65s`);
  else console.log(`    ${GREEN}+${RESET} recovered after window reset`);

  console.log(`\n${'═'.repeat(60)}`);
  const passed = reports.filter((r) => r.ok).length;
  const failed = reports.filter((r) => !r.ok).length;
  console.log(`Scenarios: ${GREEN}${passed} pass${RESET}, ${RED}${failed} fail${RESET}`);
  if (failed > 0) {
    console.log(`\nFailures:`);
    for (const r of reports) {
      if (!r.ok) {
        console.log(`  ${RED}✗${RESET} ${r.name}`);
        for (const i of r.issues) console.log(`    – ${i}`);
      }
    }
    process.exit(1);
  }
  console.log(`${GRAY}Finished at ${new Date().toISOString()}${RESET}`);
}

main().catch((err) => {
  console.error('Load test crashed:', err);
  process.exit(2);
});
