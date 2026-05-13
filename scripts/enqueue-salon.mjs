// Manually trigger the template enqueue for a salon. Same logic the
// admin "Senkronize Et" button hits server-side.
//
// Usage: node scripts/enqueue-salon.mjs <salonId> [tone]
//   tone defaults to FRIENDLY; allowed: FRIENDLY|BALANCED|PROFESSIONAL
import 'dotenv/config';
import { enqueueSalonTemplates } from '../src/services/salonTemplateSubmitter.ts';

const salonId = Number(process.argv[2] || 2);
const tone = (process.argv[3] || 'FRIENDLY');

const r = await enqueueSalonTemplates({ salonId, tone });
console.log('Enqueue result:', JSON.stringify(r));
process.exit(0);
