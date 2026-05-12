// Repair templateVariations.ts to comply with Meta's 2026 template rules:
//
//   1. No variation body may start or end with a {{var}} placeholder
//      ("Variables can't be at the start or end of the template").
//   2. location_url is moved out of the body and into a URL button (handled
//      in salonTemplateSubmitter.ts paramNames). So all body references
//      to {{location_url}} get stripped along with their surrounding
//      label ("Konum:", "Yol tarifi:", "Harita:", "Detay:" etc).
//
// Tone-aware leading prefix added when a variation starts with {{name}}:
//   FRIENDLY      → "Hey "
//   BALANCED      → "Merhaba "
//   PROFESSIONAL  → "Sayın "

import fs from 'node:fs';

const FILE = 'src/services/templateVariations.ts';
const text = fs.readFileSync(FILE, 'utf8');
const lines = text.split('\n');

let currentTone = null;
let leadingFixed = 0;
let trailingFixed = 0;
let locationStripped = 0;

const stripLocationPatterns = [
  // Various ways {{location_url}} appears at the end of a body, with a label.
  /\s*[—–\-]+\s*\{\{location_url\}\}/g,
  /\s*\|\s*[A-Za-zÇĞİÖŞÜçğıöşü ]+:\s*\{\{location_url\}\}/g,
  /\s*[A-Za-zÇĞİÖŞÜçğıöşü ]+(bağlantısı|tarifi|tarif|tarifim|konum|harita|detay|adres):\s*\{\{location_url\}\}/gi,
  /\s*[.,]?\s*[A-Za-zÇĞİÖŞÜçğıöşü ]+\s*\{\{location_url\}\}/g,
  // Fallback: just the variable itself with any preceding punctuation/space.
  /\s*[.,—–\-|]?\s*\{\{location_url\}\}/g,
];

const out = lines.map(line => {
  // Track which tone block we're in.
  const toneMatch = line.match(/^\s*(FRIENDLY|BALANCED|PROFESSIONAL):\s*\{$/);
  if (toneMatch) currentTone = toneMatch[1];

  // Only operate on lines that look like variation entries — quoted bodies.
  if (!/^\s*"[^"]+",?\s*$/.test(line)) return line;

  // Step 1: strip {{location_url}} and its surrounding label/separator.
  if (line.includes('{{location_url}}')) {
    let before = line;
    for (const pat of stripLocationPatterns) {
      line = line.replace(pat, '');
    }
    // If we still have {{location_url}} (no pattern matched), force-remove.
    line = line.replace(/\s*\{\{location_url\}\}/g, '');
    if (before !== line) locationStripped++;
    // Clean trailing whitespace before closing quote.
    line = line.replace(/\s+(",?\s*)$/, '$1');
  }

  // Step 2: trailing variable at end of body. After stripping location_url,
  // some bodies may now end with another {{var}} — handle generically.
  // Match: any `}}` immediately followed by `",` (no period, emoji, or word
  // in between) — Meta still rejects.
  const trailingMatch = line.match(/^\s*"[^"]*?\}\}",\s*$/);
  if (trailingMatch) {
    // Insert a period or subtle separator before the closing quote.
    const tail = currentTone === 'PROFESSIONAL' ? '.' : ' »';
    line = line.replace(/\}\}",\s*$/, `}}${tail}",`);
    trailingFixed++;
  }

  // Step 3: leading variable — line starts with `"{{var}}`. Add tone prefix.
  const leadingMatch = line.match(/^(\s*)"(\{\{[a-z_]+\}\})/);
  if (leadingMatch && currentTone) {
    const prefix =
      currentTone === 'FRIENDLY' ? 'Hey '
      : currentTone === 'BALANCED' ? 'Merhaba '
      : 'Sayın ';
    line = line.replace(/^(\s*)"(\{\{)/, `$1"${prefix}$2`);
    leadingFixed++;
  }

  return line;
});

fs.writeFileSync(FILE, out.join('\n'));
console.log(`Fixed: ${leadingFixed} leading, ${trailingFixed} trailing, ${locationStripped} location_url stripped`);
