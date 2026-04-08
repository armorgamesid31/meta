import { Router } from 'express';
import {
  commitImportBatch,
  completeImportSourceFile,
  createImportBatch,
  createImportFilePresign,
  getImportAiConfig,
  getImportBatchState,
  getImportBenchmarkRuns,
  getImportPreview,
  getImportReport,
  saveImportMappingDecisions,
  selectImportBenchmarkCandidate,
  triggerImportBenchmarkForFile,
  upsertImportAiConfig,
} from '../services/importWizard.js';

const router = Router();

function getAuth(req: any, res: any): { salonId: number; userId: number } | null {
  const salonId = Number(req.user?.salonId);
  const userId = Number(req.user?.userId);
  if (!Number.isInteger(salonId) || salonId <= 0 || !Number.isInteger(userId) || userId <= 0) {
    res.status(401).json({ message: 'Unauthorized.' });
    return null;
  }
  return { salonId, userId };
}

function asTrimmed(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

router.get('/ai-config', async (req: any, res: any) => {
  const auth = getAuth(req, res);
  if (!auth) return;

  try {
    const result = await getImportAiConfig();
    return res.status(200).json(result);
  } catch (error) {
    console.error('Admin import ai config get error:', error);
    return res.status(500).json({ message: 'Internal server error.' });
  }
});

router.put('/ai-config', async (req: any, res: any) => {
  const auth = getAuth(req, res);
  if (!auth) return;

  try {
    const config = await upsertImportAiConfig({
      userId: auth.userId,
      ocrProvider: asTrimmed(req.body?.ocrProvider),
      ocrModel: asTrimmed(req.body?.ocrModel) || null,
      llmProvider: asTrimmed(req.body?.llmProvider),
      llmModel: asTrimmed(req.body?.llmModel),
      promptVersion: asTrimmed(req.body?.promptVersion),
      promptLabel: asTrimmed(req.body?.promptLabel) || null,
      outputContractVersion: asTrimmed(req.body?.outputContractVersion),
      notesJson: req.body?.notesJson || null,
    });
    return res.status(200).json({ config });
  } catch (error) {
    console.error('Admin import ai config put error:', error);
    return res.status(500).json({ message: 'Internal server error.' });
  }
});

router.post('/', async (req: any, res: any) => {
  const auth = getAuth(req, res);
  if (!auth) return;

  try {
    const batch = await createImportBatch({
      salonId: auth.salonId,
      userId: auth.userId,
    });
    return res.status(201).json({ batch });
  } catch (error) {
    const message = (error as any)?.message || '';
    if (/import_prerequisites_missing/.test(message)) {
      const missing = message.split(':')[1] || '';
      return res.status(409).json({
        message:
          missing === 'service,staff' || missing === 'staff,service'
            ? 'Import için önce en az 1 hizmet ve en az 1 uzman eklemelisiniz.'
            : missing === 'service'
              ? 'Import için önce en az 1 hizmet eklemelisiniz.'
              : 'Import için önce en az 1 uzman eklemelisiniz.',
        code: 'IMPORT_PREREQUISITES_MISSING',
      });
    }
    console.error('Admin import create batch error:', error);
    return res.status(500).json({ message: 'Internal server error.' });
  }
});

router.post('/:batchId/files/presign', async (req: any, res: any) => {
  const auth = getAuth(req, res);
  if (!auth) return;

  const batchId = asTrimmed(req.params.batchId);
  const fileName = asTrimmed(req.body?.fileName);
  const mimeType = asTrimmed(req.body?.mimeType) || null;
  const sizeBytes = Number(req.body?.sizeBytes);

  if (!batchId || !fileName) {
    return res.status(400).json({ message: 'batchId and fileName are required.' });
  }

  try {
    const result = await createImportFilePresign({
      salonId: auth.salonId,
      batchId,
      fileName,
      mimeType,
      sizeBytes: Number.isFinite(sizeBytes) ? sizeBytes : null,
    });
    return res.status(200).json(result);
  } catch (error: any) {
    const message = error?.message || 'Internal server error.';
    if (/batch_not_found/.test(message)) {
      return res.status(404).json({ message: 'Import batch not found.' });
    }
    if (/batch_not_open_for_upload/.test(message)) {
      return res.status(409).json({ message: 'Import batch is not open for upload.' });
    }
    console.error('Admin import file presign error:', error);
    return res.status(500).json({ message: 'Internal server error.' });
  }
});

router.post('/:batchId/files/complete', async (req: any, res: any) => {
  const auth = getAuth(req, res);
  if (!auth) return;

  const batchId = asTrimmed(req.params.batchId);
  const fileId = Number(req.body?.fileId);
  const objectKey = asTrimmed(req.body?.objectKey) || null;
  const publicUrl = asTrimmed(req.body?.publicUrl) || null;

  if (!batchId || !Number.isInteger(fileId) || fileId <= 0) {
    return res.status(400).json({ message: 'batchId and valid fileId are required.' });
  }

  try {
    const result = await completeImportSourceFile({
      salonId: auth.salonId,
      batchId,
      fileId,
      objectKey,
      publicUrl,
    });
    return res.status(200).json(result);
  } catch (error: any) {
    const message = error?.message || 'Internal server error.';
    if (/source_file_not_found/.test(message)) {
      return res.status(404).json({ message: 'Source file not found.' });
    }
    console.error('Admin import complete file error:', error);
    return res.status(500).json({ message: 'Internal server error.' });
  }
});

router.get('/:batchId', async (req: any, res: any) => {
  const auth = getAuth(req, res);
  if (!auth) return;

  const batchId = asTrimmed(req.params.batchId);
  if (!batchId) {
    return res.status(400).json({ message: 'batchId is required.' });
  }

  try {
    const batch = await getImportBatchState({ salonId: auth.salonId, batchId });
    return res.status(200).json({ batch });
  } catch (error: any) {
    if (/batch_not_found/.test(error?.message || '')) {
      return res.status(404).json({ message: 'Import batch not found.' });
    }
    console.error('Admin import batch status error:', error);
    return res.status(500).json({ message: 'Internal server error.' });
  }
});

router.get('/:batchId/preview', async (req: any, res: any) => {
  const auth = getAuth(req, res);
  if (!auth) return;

  const batchId = asTrimmed(req.params.batchId);
  const limitRows = Number(req.query?.limitRows);
  if (!batchId) {
    return res.status(400).json({ message: 'batchId is required.' });
  }

  try {
    const preview = await getImportPreview({
      salonId: auth.salonId,
      batchId,
      limitRows: Number.isFinite(limitRows) ? limitRows : undefined,
    });
    return res.status(200).json(preview);
  } catch (error: any) {
    if (/batch_not_found/.test(error?.message || '')) {
      return res.status(404).json({ message: 'Import batch not found.' });
    }
    console.error('Admin import preview error:', error);
    return res.status(500).json({ message: 'Internal server error.' });
  }
});

router.get('/:batchId/files/:fileId/benchmark', async (req: any, res: any) => {
  const auth = getAuth(req, res);
  if (!auth) return;

  const batchId = asTrimmed(req.params.batchId);
  const fileId = Number(req.params.fileId);
  if (!batchId || !Number.isInteger(fileId) || fileId <= 0) {
    return res.status(400).json({ message: 'batchId and valid fileId are required.' });
  }

  try {
    const runs = await getImportBenchmarkRuns({
      salonId: auth.salonId,
      batchId,
      sourceFileId: fileId,
    });
    return res.status(200).json({ runs });
  } catch (error: any) {
    if (/source_file_not_found/.test(error?.message || '')) {
      return res.status(404).json({ message: 'Source file not found.' });
    }
    console.error('Admin import benchmark runs error:', error);
    return res.status(500).json({ message: 'Internal server error.' });
  }
});

router.post('/:batchId/files/:fileId/benchmark/trigger', async (req: any, res: any) => {
  const auth = getAuth(req, res);
  if (!auth) return;

  const batchId = asTrimmed(req.params.batchId);
  const fileId = Number(req.params.fileId);
  if (!batchId || !Number.isInteger(fileId) || fileId <= 0) {
    return res.status(400).json({ message: 'batchId and valid fileId are required.' });
  }

  try {
    const result = await triggerImportBenchmarkForFile({
      salonId: auth.salonId,
      batchId,
      sourceFileId: fileId,
      benchmarkReferenceText:
        typeof req.body?.benchmarkReferenceText === 'string'
          ? req.body.benchmarkReferenceText
          : typeof req.body?.referenceText === 'string'
            ? req.body.referenceText
            : null,
    });
    return res.status(200).json(result);
  } catch (error: any) {
    const message = error?.message || 'Internal server error.';
    if (/source_file_not_found/.test(message)) {
      return res.status(404).json({ message: 'Source file not found.' });
    }
    if (/benchmark_requires_ocr_source/.test(message)) {
      return res.status(409).json({ message: 'Benchmark OCR is only available for image/pdf files.' });
    }
    console.error('Admin import benchmark trigger error:', error);
    return res.status(500).json({ message: 'Internal server error.' });
  }
});

router.post('/benchmark/candidates/:candidateId/select', async (req: any, res: any) => {
  const auth = getAuth(req, res);
  if (!auth) return;

  const candidateId = Number(req.params.candidateId);
  if (!Number.isInteger(candidateId) || candidateId <= 0) {
    return res.status(400).json({ message: 'Valid candidateId is required.' });
  }

  try {
    const result = await selectImportBenchmarkCandidate({
      salonId: auth.salonId,
      userId: auth.userId,
      candidateId,
      activateConfig: req.body?.activateConfig !== false,
    });
    return res.status(200).json(result);
  } catch (error: any) {
    if (/candidate_not_found/.test(error?.message || '')) {
      return res.status(404).json({ message: 'Benchmark candidate not found.' });
    }
    console.error('Admin import benchmark candidate select error:', error);
    return res.status(500).json({ message: 'Internal server error.' });
  }
});

router.post('/:batchId/mappings', async (req: any, res: any) => {
  const auth = getAuth(req, res);
  if (!auth) return;

  const batchId = asTrimmed(req.params.batchId);
  const decisions = Array.isArray(req.body?.decisions) ? req.body.decisions : [];
  if (!batchId) {
    return res.status(400).json({ message: 'batchId is required.' });
  }

  try {
    const result = await saveImportMappingDecisions({
      salonId: auth.salonId,
      batchId,
      userId: auth.userId,
      decisions: decisions.map((decision: any) => ({
        rowId: decision?.rowId,
        conflictId: decision?.conflictId,
        decisionType: String(decision?.decisionType || 'MANUAL_PATCH'),
        decisionKey: String(decision?.decisionKey || 'manual'),
        decisionValue: decision?.decisionValue || {},
      })),
    });
    return res.status(200).json(result);
  } catch (error: any) {
    if (/batch_not_found/.test(error?.message || '')) {
      return res.status(404).json({ message: 'Import batch not found.' });
    }
    console.error('Admin import mappings error:', error);
    return res.status(500).json({ message: 'Internal server error.' });
  }
});

router.post('/:batchId/commit', async (req: any, res: any) => {
  const auth = getAuth(req, res);
  if (!auth) return;

  const batchId = asTrimmed(req.params.batchId);
  if (!batchId) {
    return res.status(400).json({ message: 'batchId is required.' });
  }

  try {
    const result = await commitImportBatch({
      salonId: auth.salonId,
      batchId,
      userId: auth.userId,
    });
    return res.status(200).json(result);
  } catch (error: any) {
    const message = error?.message || 'Internal server error.';
    if (/batch_not_found/.test(message)) {
      return res.status(404).json({ message: 'Import batch not found.' });
    }
    if (/open_conflicts_remaining/.test(message)) {
      return res.status(409).json({ message: 'Open conflicts remain. Resolve conflicts before commit.' });
    }
    if (/commit_already_running/.test(message)) {
      return res.status(409).json({ message: 'Commit is already running.' });
    }
    console.error('Admin import commit error:', error);
    return res.status(500).json({ message: 'Internal server error.' });
  }
});

router.get('/:batchId/report', async (req: any, res: any) => {
  const auth = getAuth(req, res);
  if (!auth) return;

  const batchId = asTrimmed(req.params.batchId);
  if (!batchId) {
    return res.status(400).json({ message: 'batchId is required.' });
  }

  try {
    const report = await getImportReport({
      salonId: auth.salonId,
      batchId,
    });
    return res.status(200).json(report);
  } catch (error: any) {
    if (/batch_not_found/.test(error?.message || '')) {
      return res.status(404).json({ message: 'Import batch not found.' });
    }
    console.error('Admin import report error:', error);
    return res.status(500).json({ message: 'Internal server error.' });
  }
});

export default router;
