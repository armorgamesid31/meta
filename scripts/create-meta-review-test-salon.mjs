#!/usr/bin/env node

import 'dotenv/config';
import crypto from 'crypto';

function usage() {
  console.log('Usage:');
  console.log('  node scripts/create-meta-review-test-salon.mjs');
  console.log('  node scripts/create-meta-review-test-salon.mjs --base-url=https://app.berkai.shop');
  console.log('  node scripts/create-meta-review-test-salon.mjs --email=test@example.com --password=StrongPass!123');
}

function parseArgs(argv) {
  const args = {
    baseUrl: process.env.REGISTER_SALON_BASE_URL || process.env.FRONTEND_URL || 'http://127.0.0.1:3000',
    email: '',
    password: '',
    salonName: '',
  };

  for (const arg of argv) {
    if (arg === '--help' || arg === '-h') {
      usage();
      process.exit(0);
    }
    if (arg.startsWith('--base-url=')) {
      args.baseUrl = arg.slice('--base-url='.length);
      continue;
    }
    if (arg.startsWith('--email=')) {
      args.email = arg.slice('--email='.length).trim();
      continue;
    }
    if (arg.startsWith('--password=')) {
      args.password = arg.slice('--password='.length);
      continue;
    }
    if (arg.startsWith('--salon-name=')) {
      args.salonName = arg.slice('--salon-name='.length).trim();
      continue;
    }
    throw new Error(`Unknown argument: ${arg}`);
  }

  return args;
}

function nowStamp(date) {
  const yyyy = date.getUTCFullYear();
  const mm = String(date.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(date.getUTCDate()).padStart(2, '0');
  const hh = String(date.getUTCHours()).padStart(2, '0');
  const min = String(date.getUTCMinutes()).padStart(2, '0');
  return `${yyyy}${mm}${dd}-${hh}${min}`;
}

function generatePassword(length = 24) {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%^&*()-_=+';
  const bytes = crypto.randomBytes(length);
  let out = '';
  for (let i = 0; i < length; i += 1) {
    out += alphabet[bytes[i] % alphabet.length];
  }
  return out;
}

async function main() {
  const parsed = parseArgs(process.argv.slice(2));
  const now = new Date();
  const stamp = nowStamp(now);
  const ts = Date.now();

  const email = parsed.email || `meta.review.${ts}@kedyapp.test`;
  const password = parsed.password || generatePassword();
  const salonName = parsed.salonName || `Meta Review Test Salon ${stamp}`;
  const baseUrl = parsed.baseUrl.replace(/\/+$/, '');
  const endpoint = `${baseUrl}/auth/register-salon`;

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      email,
      password,
      salonName,
    }),
  });

  const rawBody = await response.text();
  let parsedBody = null;
  try {
    parsedBody = rawBody ? JSON.parse(rawBody) : null;
  } catch {
    parsedBody = null;
  }

  if (!response.ok) {
    console.error('create-meta-review-test-salon failed');
    console.error(
      JSON.stringify(
        {
          endpoint,
          status: response.status,
          statusText: response.statusText,
          body: parsedBody || rawBody,
        },
        null,
        2,
      ),
    );
    process.exit(1);
  }

  const user = parsedBody?.user || {};
  console.log(
    JSON.stringify(
      {
        success: true,
        endpoint,
        salonName,
        email,
        password,
        salonId: user.salonId || null,
        userId: user.id || null,
        role: user.role || null,
        accessToken: parsedBody?.accessToken || parsedBody?.token || null,
        refreshToken: parsedBody?.refreshToken || null,
      },
      null,
      2,
    ),
  );
}

main().catch((error) => {
  console.error('create-meta-review-test-salon error:', error);
  process.exit(1);
});
