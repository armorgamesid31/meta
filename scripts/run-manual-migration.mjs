import { PrismaClient } from '@prisma/client';
import { readFileSync } from 'fs';
import 'dotenv/config';

const prisma = new PrismaClient();
const sql = readFileSync('prisma/migrations/manual_onboarding_b1_b6_b7.sql', 'utf-8');

// Split by `;` but ignore separators inside DO $$ ... END $$; blocks.
const parts = [];
let buf = '';
let inDo = false;
for (let i = 0; i < sql.length; i++) {
  buf += sql[i];
  const upcoming = sql.slice(i);
  if (!inDo && /^DO\s+\$\$/i.test(upcoming)) inDo = true;
  if (inDo && /^END\s+\$\$/i.test(upcoming)) {
    inDo = false;
    // consume until ';'
    while (i < sql.length && sql[i] !== ';') { i++; buf += (sql[i] ?? ''); }
    parts.push(buf.trim());
    buf = '';
    continue;
  }
  if (!inDo && sql[i] === ';') {
    parts.push(buf.trim());
    buf = '';
  }
}
if (buf.trim()) parts.push(buf.trim());

const stmts = parts.filter((s) => s && !s.startsWith('--') && s !== ';');
let ok = 0;
let fail = 0;
for (const s of stmts) {
  try {
    await prisma.$executeRawUnsafe(s);
    ok++;
    const firstLine = s.split('\n')[0].slice(0, 90).replace(/\s+/g, ' ');
    console.log(`OK   | ${firstLine}`);
  } catch (e) {
    fail++;
    const firstLine = s.split('\n')[0].slice(0, 90).replace(/\s+/g, ' ');
    console.log(`FAIL | ${firstLine} | ${String(e.message).split('\n')[0]}`);
  }
}
console.log(`\nDone: ${ok} ok, ${fail} fail (out of ${stmts.length})`);
await prisma.$disconnect();
