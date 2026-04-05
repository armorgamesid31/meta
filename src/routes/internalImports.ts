import { Router } from 'express';
import { processImportOcrCallback } from '../services/importWizard.js';

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
  const rows = Array.isArray(req.body?.rows) ? req.body.rows : [];

  if (!batchId || !Number.isInteger(sourceFileId) || sourceFileId <= 0) {
    return res.status(400).json({ message: 'batchId and valid sourceFileId are required.' });
  }

  try {
    const result = await processImportOcrCallback({
      batchId,
      sourceFileId,
      extractionError,
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

export default router;
