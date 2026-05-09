#!/usr/bin/env node
/**
 * One-shot migration: rewrites `res.status(N).json({ message: '...' })`
 * call sites to `throw new BusinessError('CODE', '...', N)` so every
 * error response flows through errorMiddleware and inherits the
 * { code, message, traceId } envelope.
 *
 * Handles:
 *   - return res.status(N).json({ message: 'X' });
 *   - res.status(N).json({ message: `tpl ${x}` });
 *   - return res.status(N).json({ message: 'X', a: 1, b: 2 });
 *
 * Skips (manual review):
 *   - multi-line { ... } payloads
 *   - res.json({ ... }) without status
 *   - res.sendStatus()
 *   - non-error 200/201 responses
 */
import { readFile, writeFile, readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, '..', 'src', 'routes');

const STATUS_TO_CODE = {
  400: 'VALIDATION_FAILED',
  401: 'UNAUTHORIZED',
  403: 'FORBIDDEN',
  404: 'NOT_FOUND',
  409: 'CONFLICT',
  410: 'GONE',
  422: 'VALIDATION_FAILED',
  500: 'INTERNAL_ERROR',
  502: 'BAD_GATEWAY',
};

// Match: optional `return ` + res.status(N).json({ message: <expr>, ...rest? }) + ;
// <expr> can be 'literal', "literal", or `template ${x}`. We capture by
// matching balanced quotes.
//
// Strategy: hand-rolled tokenizer would be cleanest, but for one-shot
// migration we accept missing the multi-line cases. The regex captures
// up to the FIRST closing `})` on the SAME line.
const PATTERN = /(\b(?:return\s+)?)res\.status\((\d{3})\)\.json\(\{\s*message:\s*((?:'(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*"|`(?:[^`\\]|\\.|\\\$\{[^}]*\})*`))(\s*,\s*([^}]*?))?\s*\}\)\s*;?/g;

function rewriteFile(source) {
  let modified = false;
  const out = source.replace(
    PATTERN,
    (full, returnPrefix, statusStr, messageExpr, _comma, restRaw) => {
      const status = Number(statusStr);
      const code = STATUS_TO_CODE[status];
      if (!code) return full; // unknown status; skip

      let detailsArg = '';
      const rest = (restRaw || '').trim();
      if (rest) {
        // Wrap remaining fields into a details object
        detailsArg = `, { ${rest} }`;
      }

      modified = true;
      const stmt = `throw new BusinessError('${code}', ${messageExpr}, ${status}${detailsArg});`;
      // If the original was `return res.status...;`, drop the `return ` —
      // throwing already exits the function.
      void returnPrefix;
      return stmt;
    },
  );

  if (!modified) return null;

  // Ensure BusinessError import is present
  if (!/from ['"]\.\.\/lib\/errors\.js['"]/.test(out) && !/from ['"]\.\.\/lib\/errors['"]/.test(out)) {
    // Insert import after the first import block
    const importBlock = out.match(/^((?:import [^\n]+\n)+)/);
    if (importBlock) {
      const newImports =
        importBlock[1] + "import { BusinessError } from '../lib/errors.js';\n";
      return out.replace(importBlock[1], newImports);
    }
    // No imports at all — prepend
    return "import { BusinessError } from '../lib/errors.js';\n" + out;
  }

  return out;
}

async function* walk(dir) {
  const entries = await readdir(dir);
  for (const entry of entries) {
    const full = path.join(dir, entry);
    const info = await stat(full);
    if (info.isDirectory()) {
      yield* walk(full);
    } else if (info.isFile() && entry.endsWith('.ts') && !entry.endsWith('.test.ts')) {
      yield full;
    }
  }
}

async function main() {
  let touched = 0;
  let changed = 0;
  for await (const file of walk(ROOT)) {
    touched++;
    const src = await readFile(file, 'utf8');
    const next = rewriteFile(src);
    if (next === null) continue;
    if (next === src) continue;
    await writeFile(file, next, 'utf8');
    changed++;
    const before = (src.match(PATTERN) || []).length;
    console.log(`✓ ${path.relative(ROOT, file)} (${before} replacements)`);
  }
  console.log(`\nVisited ${touched} files, rewrote ${changed}.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
