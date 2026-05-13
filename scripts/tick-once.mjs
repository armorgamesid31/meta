// One-shot: run a submission tick and exit. Useful for manual prod
// nudges when the background worker isn't running.
import 'dotenv/config';
import { runSubmissionTick } from '../src/services/salonTemplateSubmitter.ts';

const batch = Number(process.argv[2] || 5);
const r = await runSubmissionTick({ batchSize: batch });
console.log('Tick:', JSON.stringify(r));
process.exit(0);
