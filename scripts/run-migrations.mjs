import { PrismaClient } from '@prisma/client';
import { readFileSync } from 'fs';
import 'dotenv/config';

const prisma = new PrismaClient();

// Aldığın her SQL dosyasını parça parça çalıştır — DO $$ ... END $$;
// bloklarındaki noktalı virgüller bölme dışında bırakılır.
function splitSql(sql) {
  const parts = [];
  let buf = '';
  let inDo = false;
  for (let i = 0; i < sql.length; i++) {
    buf += sql[i];
    const upcoming = sql.slice(i);
    if (!inDo && /^DO\s+\$\$/i.test(upcoming)) inDo = true;
    if (inDo && /^END\s+\$\$/i.test(upcoming)) {
      inDo = false;
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
  // Bir parçanın baş kısmında comment satırları olsa bile, asıl SQL
  // varsa onu sayıyoruz. `startsWith('--')` ile filtrelemek dosyaların
  // başındaki açıklama bloğuyla başlayan ilk gerçek ALTER/CREATE'i
  // kaybediyordu — comment satırlarını öncelikle temizle.
  return parts
    .map((s) => s.replace(/^[\s]*(?:--[^\n]*\n)+/g, '').trim())
    .filter((s) => s && s !== ';');
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
