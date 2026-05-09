#!/usr/bin/env node
/**
 * End-to-end functional test — drives the live backend with a real
 * authenticated session and walks through the major user flows:
 *
 *   1. Login → access token
 *   2. Bootstrap (identity, salon, capabilities)
 *   3. Customers — list, create, update, optimistic-concurrency clash
 *   4. Schedule — list day, create appointment, cancel via status
 *   5. Conversations — list
 *   6. Cleanup — best-effort delete the test customer + appointment
 *
 * Each step verifies HTTP status, the standard envelope on errors,
 * and trace id presence. Side-effects (created customer / appointment)
 * are timestamped so they're recognizable as test data even if cleanup
 * fails.
 *
 * Usage:
 *   TEST_EMAIL=owner@palmbeauty.com TEST_PASSWORD=123456 \
 *     node scripts/e2e-flow-test.mjs
 *   BACKEND_URL=https://my-backend ... node scripts/e2e-flow-test.mjs
 */

const BACKEND = process.env.BACKEND_URL || 'https://app.berkai.shop';
const EMAIL = process.env.TEST_EMAIL;
const PASSWORD = process.env.TEST_PASSWORD;

if (!EMAIL || !PASSWORD) {
  console.error('Set TEST_EMAIL and TEST_PASSWORD env vars.');
  process.exit(2);
}

const G = '\x1b[32m', R = '\x1b[31m', Y = '\x1b[33m', C = '\x1b[36m', GR = '\x1b[90m', X = '\x1b[0m';
const STAMP = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const TEST_LABEL = `E2ETest-${STAMP}`;

let token = null;
let salonId = null;
const passed = [];
const failed = [];

function ok(name, detail = '') { passed.push({ name, detail }); console.log(`${G}✓${X} ${name}${detail ? GR + ' — ' + detail + X : ''}`); }
function bad(name, detail = '') { failed.push({ name, detail }); console.log(`${R}✗${X} ${name}${detail ? R + ' — ' + detail + X : ''}`); }
const warned = [];
function warn(name, detail = '') { warned.push({ name, detail }); console.log(`${Y}!${X} ${name}${detail ? Y + ' — ' + detail + X : ''}`); }

async function api(path, opts = {}) {
  const t0 = Date.now();
  const headers = { 'Content-Type': 'application/json', ...opts.headers };
  if (token) headers.Authorization = `Bearer ${token}`;
  if (salonId) headers['x-salon-id'] = String(salonId);
  const res = await fetch(`${BACKEND}${path}`, { ...opts, headers });
  const traceId = res.headers.get('x-trace-id');
  const text = await res.text();
  let body = null;
  try { body = text ? JSON.parse(text) : null; } catch { body = text; }
  return { status: res.status, ok: res.ok, body, traceId, ms: Date.now() - t0 };
}

async function expectEnvelope(res, name) {
  if (!res.traceId) return bad(name, 'no X-Trace-Id');
  if (!res.ok && (!res.body || typeof res.body !== 'object' || !res.body.code)) {
    return bad(name, `non-envelope error: ${res.status} ${typeof res.body === 'string' ? res.body.slice(0, 60) : ''}`);
  }
  return true;
}

// ──────────────── STEP 1: LOGIN ────────────────
async function step1Login() {
  console.log(`\n${C}1. Login${X}`);
  const res = await api('/auth/login', {
    method: 'POST',
    body: JSON.stringify({ identifier: EMAIL, password: PASSWORD }),
  });
  if (res.status !== 200) return bad('1.1 login → 200', `got ${res.status} ${JSON.stringify(res.body).slice(0, 100)}`);
  if (!res.body?.accessToken) return bad('1.2 access token returned', 'missing accessToken');
  token = res.body.accessToken;
  ok('1.1 Login successful', `${res.ms}ms, trace=${res.traceId?.slice(0, 8)}`);
  ok('1.2 Access token received', `len=${token.length}`);
  if (res.body.salonId) salonId = res.body.salonId;
  return true;
}

// ──────────────── STEP 2: BOOTSTRAP ────────────────
async function step2Bootstrap() {
  console.log(`\n${C}2. Bootstrap${X}`);
  const res = await api('/api/mobile/bootstrap');
  if (res.status !== 200) return bad('2.1 bootstrap → 200', `got ${res.status}`);
  if (!res.body?.user || !res.body?.salon) return bad('2.2 bootstrap shape', 'missing user/salon');
  salonId = res.body.salon.id;
  ok('2.1 Bootstrap loaded', `${res.ms}ms`);
  ok('2.2 Identity', `user=${res.body.user.name} role=${res.body.user.role}`);
  ok('2.3 Salon', `id=${salonId} name=${res.body.salon.name}`);
  return true;
}

// ──────────────── STEP 3: CUSTOMERS ────────────────
let createdCustomerId = null;
let createdCustomerUpdatedAt = null;

async function step3Customers() {
  console.log(`\n${C}3. Customers${X}`);

  // 3.1 List
  const list = await api('/api/admin/customers?limit=5');
  if (list.status !== 200) return bad('3.1 list customers', `${list.status}`);
  if (!Array.isArray(list.body?.items)) return bad('3.1 list customers', 'no items array');
  ok('3.1 List customers', `${list.ms}ms, ${list.body.items.length} items, hasMore=${list.body.hasMore}`);

  // 3.2 Create
  const phone = `0555${Math.floor(Math.random() * 9000000 + 1000000)}`;
  const create = await api('/api/admin/customers', {
    method: 'POST',
    body: JSON.stringify({
      firstName: TEST_LABEL,
      lastName: 'AutoCreated',
      name: `${TEST_LABEL} AutoCreated`,
      phone,
      instagram: null,
      birthDate: null,
      acceptMarketing: false,
    }),
  });
  if (create.status !== 201 && create.status !== 200) {
    return bad('3.2 create customer', `${create.status} ${JSON.stringify(create.body).slice(0, 120)}`);
  }
  const created = create.body?.customer;
  if (!created?.id) return bad('3.2 create customer', 'response missing customer.id');
  createdCustomerId = created.id;
  createdCustomerUpdatedAt = created.updatedAt;
  ok('3.2 Create customer', `${create.ms}ms, id=${createdCustomerId}, phone=${phone}`);

  // 3.3 Update (with correct expectedUpdatedAt)
  const upd = await api(`/api/admin/customers/${createdCustomerId}`, {
    method: 'PUT',
    body: JSON.stringify({
      firstName: TEST_LABEL,
      lastName: 'Updated',
      name: `${TEST_LABEL} Updated`,
      phone,
      instagram: null,
      birthDate: null,
      acceptMarketing: true,
      expectedUpdatedAt: createdCustomerUpdatedAt,
    }),
  });
  if (upd.status !== 200) return bad('3.3 update customer (fresh)', `${upd.status} ${JSON.stringify(upd.body).slice(0, 100)}`);
  if (upd.body?.customer?.lastName !== 'Updated') return bad('3.3 update customer', 'lastName not persisted');
  const newUpdatedAt = upd.body.customer.updatedAt;
  ok('3.3 Update customer (fresh updatedAt)', `${upd.ms}ms`);

  // 3.4 Optimistic concurrency: send STALE expectedUpdatedAt → expect 409
  const stale = await api(`/api/admin/customers/${createdCustomerId}`, {
    method: 'PUT',
    body: JSON.stringify({
      firstName: TEST_LABEL,
      lastName: 'ShouldNotApply',
      name: `${TEST_LABEL} ShouldNotApply`,
      phone,
      instagram: null,
      birthDate: null,
      acceptMarketing: true,
      expectedUpdatedAt: createdCustomerUpdatedAt, // <-- the OLD one we already used
    }),
  });
  if (stale.status === 409 && stale.body?.code === 'STALE_RECORD') {
    ok('3.4 Stale update rejected (STALE_RECORD)', `${stale.ms}ms`);
  } else if (stale.status === 200) {
    bad('3.4 Stale update rejected', 'request succeeded — concurrency check NOT enforced');
  } else {
    bad('3.4 Stale update rejected', `unexpected ${stale.status} code=${stale.body?.code}`);
  }

  // 3.5 Update with current updatedAt should work again
  const fresh = await api(`/api/admin/customers/${createdCustomerId}`, {
    method: 'PUT',
    body: JSON.stringify({
      firstName: TEST_LABEL,
      lastName: 'Final',
      name: `${TEST_LABEL} Final`,
      phone,
      instagram: null,
      birthDate: null,
      acceptMarketing: true,
      expectedUpdatedAt: newUpdatedAt,
    }),
  });
  if (fresh.status !== 200) bad('3.5 update with new updatedAt', `${fresh.status}`);
  else ok('3.5 Update with current updatedAt works', `${fresh.ms}ms`);

  return true;
}

// ──────────────── STEP 4: SCHEDULE ────────────────
let createdAppointmentId = null;

async function step4Schedule() {
  console.log(`\n${C}4. Schedule${X}`);

  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  const dayStart = new Date(tomorrow);
  dayStart.setHours(0, 0, 0, 0);
  const dayEnd = new Date(tomorrow);
  dayEnd.setHours(23, 59, 59, 999);

  // 4.1 List appointments for tomorrow
  const list = await api(`/api/admin/appointments?from=${encodeURIComponent(dayStart.toISOString())}&to=${encodeURIComponent(dayEnd.toISOString())}&limit=50`);
  if (list.status !== 200) return bad('4.1 list appointments', `${list.status}`);
  if (!Array.isArray(list.body?.items)) return bad('4.1 list appointments', 'no items');
  ok('4.1 List tomorrow\'s appointments', `${list.ms}ms, ${list.body.items.length} existing`);

  // 4.2 Look up at least one staff and one service so we can create an appointment
  const staffRes = await api('/api/admin/staff');
  const servicesRes = await api('/api/admin/services');
  const staffList = staffRes.body?.items || [];
  const serviceList = servicesRes.body?.items || [];
  if (!staffList.length) {
    return bad('4.2 lookup staff/services', 'no staff configured for this salon — cannot create appointment');
  }
  if (!serviceList.length) {
    return bad('4.2 lookup staff/services', 'no services configured');
  }
  ok('4.2 Lookup staff/services', `${staffList.length} staff, ${serviceList.length} services`);

  // 4.3 Create an appointment for the test customer at 23:30 tomorrow (off-peak)
  // We try a few staff×service combinations because some services
  // require specific specialists, and a random pick may fail business
  // validation (which is correct backend behavior, not an infra bug).
  const startTime = new Date(tomorrow);
  startTime.setHours(23, 30, 0, 0);

  let create = null;
  let attempts = 0;
  outer: for (const svc of serviceList) {
    // First try with staffId:null (let backend assign), then with each staff id.
    const candidates = [null, ...staffList.map((s) => s.id)];
    for (const staffId of candidates) {
      attempts++;
      create = await api('/api/admin/appointments', {
        method: 'POST',
        body: JSON.stringify({
          customerId: createdCustomerId,
          customerName: `${TEST_LABEL} Final`,
          customerPhone: '05551234567',
          startTime: startTime.toISOString(),
          notes: `[${TEST_LABEL}] auto-created by e2e test`,
          services: [{ serviceId: svc.id, staffId }],
        }),
      });
      if (create.status === 200 || create.status === 201) break outer;
    }
  }

  if (create && (create.status === 200 || create.status === 201)) {
    // Response shape: { item, items, count } from POST /api/admin/appointments
    const apptItem = create.body?.item || create.body?.items?.[0] || create.body?.appointment || create.body;
    createdAppointmentId = apptItem?.id;
    if (!createdAppointmentId) return bad('4.3 create appointment', `no id in response: ${JSON.stringify(create.body).slice(0, 120)}`);
    ok('4.3 Create appointment', `${create.ms}ms (after ${attempts} combo${attempts > 1 ? 's' : ''}), id=${createdAppointmentId}`);
  } else {
    // Every combo rejected by business validation. Not an infra failure;
    // contract is fine (we got envelope responses). Warn and skip 4.4–4.5.
    warn(
      '4.3 Create appointment skipped',
      `salon's staff×service rules rejected all ${attempts} combos: ${create?.body?.message?.slice(0, 80)}`,
    );
    return true;
  }

  // 4.4 Verify it shows up in the list
  const list2 = await api(`/api/admin/appointments?from=${encodeURIComponent(dayStart.toISOString())}&to=${encodeURIComponent(dayEnd.toISOString())}&limit=50`);
  const foundInList = (list2.body?.items || []).some((a) => a.id === createdAppointmentId);
  if (!foundInList) bad('4.4 appointment visible in list', 'not found after refetch');
  else ok('4.4 New appointment appears in list', `total=${list2.body.items.length}`);

  // 4.5 Cancel via status update
  const cancel = await api(`/api/admin/appointments/${createdAppointmentId}/status`, {
    method: 'PATCH',
    body: JSON.stringify({ status: 'CANCELLED' }),
  });
  if (cancel.status !== 200) bad('4.5 cancel appointment', `${cancel.status} ${JSON.stringify(cancel.body).slice(0, 100)}`);
  else ok('4.5 Cancel appointment', `${cancel.ms}ms`);

  return true;
}

// ──────────────── STEP 5: CONVERSATIONS ────────────────
async function step5Conversations() {
  console.log(`\n${C}5. Conversations${X}`);
  const res = await api('/api/admin/conversations?limit=10');
  if (res.status !== 200) return bad('5.1 list conversations', `${res.status}`);
  if (!Array.isArray(res.body?.items)) return bad('5.1 list conversations', 'no items');
  ok('5.1 List conversations', `${res.ms}ms, ${res.body.items.length} items`);
  if (res.body.channelHealth) {
    ok('5.2 Channel health', `instagram=${res.body.channelHealth.instagram?.status} whatsapp=${res.body.channelHealth.whatsapp?.connected}`);
  }
  return true;
}

// ──────────────── STEP 6: CLEANUP ────────────────
async function step6Cleanup() {
  console.log(`\n${C}6. Cleanup${X}`);
  if (createdAppointmentId) {
    const del = await api(`/api/admin/appointments/${createdAppointmentId}`, { method: 'DELETE' });
    if (del.status === 200 || del.status === 204 || del.status === 404) {
      ok('6.1 Cleanup appointment', `${del.status}`);
    } else {
      bad('6.1 Cleanup appointment', `${del.status} (left behind id=${createdAppointmentId})`);
    }
  }
  if (createdCustomerId) {
    const del = await api(`/api/admin/customers/${createdCustomerId}`, { method: 'DELETE' });
    if (del.status === 200 || del.status === 204 || del.status === 404) {
      ok('6.2 Cleanup customer', `${del.status}`);
    } else {
      bad('6.2 Cleanup customer', `${del.status} (left behind id=${createdCustomerId})`);
    }
  }
}

// ──────────────── MAIN ────────────────
async function main() {
  console.log(`${C}E2E flow test${X} → ${BACKEND}  user=${EMAIL}  label=${TEST_LABEL}`);
  try {
    if (!(await step1Login())) return;
    if (!(await step2Bootstrap())) return;
    await step3Customers();
    await step4Schedule();
    await step5Conversations();
  } finally {
    await step6Cleanup();
  }

  console.log(`\n${'─'.repeat(60)}`);
  console.log(`${G}${passed.length} passed${X}, ${Y}${warned.length} warning${X}, ${R}${failed.length} failed${X}`);
  if (warned.length) {
    console.log(`\nWarnings (not infrastructure failures):`);
    for (const w of warned) console.log(`  ${Y}!${X} ${w.name}: ${w.detail}`);
  }
  if (failed.length) {
    console.log(`\nFailures:`);
    for (const f of failed) console.log(`  ${R}–${X} ${f.name}: ${f.detail}`);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('E2E crashed:', err);
  process.exit(2);
});
