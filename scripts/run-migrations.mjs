import { PrismaClient } from '@prisma/client';
import { readFileSync } from 'fs';
import 'dotenv/config';

const prisma = new PrismaClient();

// Aldığın her SQL dosyasını parça parça çalıştır — DO $$ ... END $$;
// bloklarındaki noktalı virgüller bölme dışında bırakılır.
function splitSql(sql) {
  // Önce yorum satırlarını sıyır — `--` ile başlayan satırlar (sadece
  // tek-satır SQL yorumu) bölme öncesinde tamamen atılır. Aksi halde
  // `-- Phase 6 (a separate ...; migration)` gibi cümlelerdeki `;`
  // sahte bir statement sınırı gibi davranıyordu.
  const stripped = sql
    .split('\n')
    .filter((line) => !line.trim().startsWith('--'))
    .join('\n');

  const parts = [];
  let buf = '';
  let inDo = false;
  for (let i = 0; i < stripped.length; i++) {
    buf += stripped[i];
    const upcoming = stripped.slice(i);
    if (!inDo && /^DO\s+\$\$/i.test(upcoming)) inDo = true;
    if (inDo && /^END\s+\$\$/i.test(upcoming)) {
      inDo = false;
      while (i < stripped.length && stripped[i] !== ';') { i++; buf += (stripped[i] ?? ''); }
      parts.push(buf.trim());
      buf = '';
      continue;
    }
    if (!inDo && stripped[i] === ';') {
      parts.push(buf.trim());
      buf = '';
    }
  }
  if (buf.trim()) parts.push(buf.trim());
  // BEGIN / COMMIT block markers: tek başına çalıştırıldıklarında
  // Prisma'nın connection-pool'unda zaten implicit bir transaction
  // var, bu yüzden bunları atla. Tüm migration'ı tek transaction
  // istiyorsa caller responsibility — şu an için her statement
  // bağımsız çalışıyor.
  return parts
    .map((s) => s.trim())
    .filter((s) => s && s !== ';' && !/^(BEGIN|COMMIT)\b/i.test(s));
}

const files = process.argv.slice(2);
if (!files.length) {
  console.error('Usage: node run-migrations.mjs <file1.sql> [file2.sql ...]');
  process.exit(1);
}

let grandOk = 0;
let grandFail = 0;
for (const f of files) {
  console.log(`\n=== ${f} ===`);
  const sql = readFileSync(f, 'utf-8');
  const stmts = splitSql(sql);
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
  console.log(`${f}: ${ok} ok, ${fail} fail (of ${stmts.length})`);
  grandOk += ok;
  grandFail += fail;
}
console.log(`\nTOTAL: ${grandOk} ok, ${grandFail} fail`);
await prisma.$disconnect();
