import { Router } from 'express';
import { getImportAiConfig, processImportOcrCallback } from '../services/importWizard.js';

const router = Router();

function isInternalAuthorized(req: any): boolean {
  const configured = process.env.INTERNAL_API_KEY;
  if (!configured) return true;
  const token = req.headers['x-internal-api-key'];
  return typeof token === 'string' && token === configured;
}

router.post('/:batchId/ocr-callback', async (req: any, res: any) => {
  if (!isInternalAuthorized(req)) {
    return res.status(401).json({ message: 'Unauthorized.' });
  }

  const batchId = typeof req.params?.batchId === 'string' ? req.params.batchId.trim() : '';
  const sourceFileId = Number(req.body?.sourceFileId || req.body?.fileId);
  const extractionError = typeof req.body?.error === 'string' ? req.body.error.trim() : null;
  const mode = typeof req.body?.mode === 'string' ? req.body.mode.trim() : null;
  const benchmarkReferenceText =
    typeof req.body?.benchmarkReferenceText === 'string' ? req.body.benchmarkReferenceText.trim() : null;
  const referenceText = typeof req.body?.referenceText === 'string' ? req.body.referenceText.trim() : null;
  const audit = req.body?.audit && typeof req.body.audit === 'object' ? req.body.audit : null;
  const candidates = Array.isArray(req.body?.candidates) ? req.body.candidates : [];
  const rows = Array.isArray(req.body?.rows) ? req.body.rows : [];

  if (!batchId || !Number.isInteger(sourceFileId) || sourceFileId <= 0) {
    return res.status(400).json({ message: 'batchId and valid sourceFileId are required.' });
  }

  try {
    const result = await processImportOcrCallback({
      batchId,
      sourceFileId,
      extractionError,
      mode,
      benchmarkReferenceText,
      referenceText,
      audit,
      candidates,
      rows,
    });
    return res.status(200).json(result);
  } catch (error: any) {
    const message = error?.message || 'Internal server error.';
    if (/source_file_not_found/.test(message)) {
      return res.status(404).json({ message: 'Source file not found.' });
    }
    console.error('Internal import OCR callback error:', error);
    return res.status(500).json({ message: 'Internal server error.' });
  }
});

router.get('/ai-config/active', async (req: any, res: any) => {
  if (!isInternalAuthorized(req)) {
    return res.status(401).json({ message: 'Unauthorized.' });
  }

  try {
    const result = await getImportAiConfig();
    return res.status(200).json(result);
  } catch (error) {
    console.error('Internal import ai config get error:', error);
    return res.status(500).json({ message: 'Internal server error.' });
  }
});

export default router;
