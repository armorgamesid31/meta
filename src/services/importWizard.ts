import { createHash } from 'crypto';
import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { parse as csvParse } from 'csv-parse/sync';
import XLSX from 'xlsx';
import type { ImportConflictType, ImportRowStatus, ImportSourceType } from '@prisma/client';
import { prisma } from '../prisma.js';
import { normalizeDigitsOnly } from './phoneValidation.js';

const PRESIGN_TTL_SECONDS = Math.max(60, Number(process.env.IMPORTS_PRESIGN_TTL_SECONDS || 900));
const IMPORT_RETENTION_DAYS = Math.max(1, Number(process.env.IMPORTS_RETENTION_DAYS || 30));
const IMPORTS_PUBLIC_BASE_URL = (
  process.env.IMPORTS_PUBLIC_BASE_URL ||
  process.env.IMPORTS_R2_PUBLIC_BASE_URL ||
  'https://cdn.kedyapp.com'
).trim();

const R2_BUCKET = (process.env.IMPORTS_R2_BUCKET || '').trim();
const R2_ENDPOINT = (process.env.IMPORTS_R2_ENDPOINT || '').trim();
const R2_ACCESS_KEY_ID = (process.env.IMPORTS_R2_ACCESS_KEY_ID || '').trim();
const R2_SECRET_ACCESS_KEY = (process.env.IMPORTS_R2_SECRET_ACCESS_KEY || '').trim();
const R2_REGION = (process.env.IMPORTS_R2_REGION || 'auto').trim();

const DAY_MS = 24 * 60 * 60 * 1000;
let r2ClientSingleton: S3Client | null | undefined;
let retentionTimer: NodeJS.Timeout | null = null;

type ParsedInputRow = {
  rowIndex: number;
  sourceType: ImportSourceType;
  raw: Record<string, unknown>;
  confidence: number | null;
};

type NormalizedImportRow = {
  rowIndex: number;
  sourceRowHash: string;
  rawData: Record<string, unknown>;
  normalizedData: Record<string, unknown>;
  customerName: string | null;
  customerPhoneRaw: string | null;
  customerPhoneNormalized: string | null;
  appointmentDate: Date | null;
  startMinute: number | null;
  endMinute: number | null;
  durationMinutes: number | null;
  serviceNameRaw: string | null;
  staffNameRaw: string | null;
  priceRaw: number | null;
  notesRaw: string | null;
  confidence: number | null;
  matchedCustomerId: number | null;
  matchedServiceId: number | null;
  matchedStaffId: number | null;
  rowStatus: ImportRowStatus;
  conflicts: Array<{ type: ImportConflictType; message: string; payload?: Record<string, unknown> }>;
};

const ALIASES: Record<string, string[]> = {
  customerName: ['customername', 'name', 'fullname', 'adsoyad', 'musteri', 'musteriadi'],
  customerPhoneRaw: ['customerphone', 'phone', 'telefon', 'mobile', 'gsm'],
  appointmentDate: ['appointmentdate', 'date', 'tarih', 'randevutarihi'],
  startTime: ['starttime', 'time', 'saat', 'baslangic', 'start'],
  endTime: ['endtime', 'bitis', 'finish', 'end'],
  durationMinutes: ['duration', 'sure', 'dakika', 'minutes'],
  serviceNameRaw: ['service', 'servicename', 'hizmet', 'islem'],
  staffNameRaw: ['staff', 'staffname', 'uzman', 'calisan', 'personel'],
  priceRaw: ['price', 'amount', 'ucret', 'tutar', 'fiyat'],
  notesRaw: ['notes', 'note', 'not', 'aciklama'],
  confidence: ['confidence', 'guven'],
};

function normalizeText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function asObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

function normalizeHeader(input: string): string {
  return input
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

function normalizeNameKey(value: string | null | undefined): string {
  return normalizeText(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

function inferSourceType(input: { fileName: string; mimeType?: string | null }): ImportSourceType {
  const name = input.fileName.toLowerCase();
  const mime = normalizeText(input.mimeType).toLowerCase();
  if (name.endsWith('.csv') || mime.includes('text/csv')) return 'CSV';
  if (name.endsWith('.xlsx') || name.endsWith('.xls') || mime.includes('spreadsheet') || mime.includes('excel')) return 'EXCEL';
  if (name.endsWith('.pdf') || mime.includes('pdf')) return 'PDF';
  if (mime.startsWith('image/') || /\.(png|jpg|jpeg|webp|heic)$/i.test(name)) return 'IMAGE';
  return 'CSV';
}

async function assertImportPrerequisites(salonId: number) {
  const [serviceCount, staffCount] = await Promise.all([
    prisma.service.count({
      where: {
        salonId,
        isActive: { not: false },
      },
    }),
    prisma.staff.count({
      where: { salonId },
    }),
  ]);

  if (serviceCount <= 0 || staffCount <= 0) {
    const missing: string[] = [];
    if (serviceCount <= 0) missing.push('service');
    if (staffCount <= 0) missing.push('staff');
    const error = new Error(`import_prerequisites_missing:${missing.join(',')}`);
    throw error;
  }
}

function isR2Configured() {
  return Boolean(R2_BUCKET && R2_ENDPOINT && R2_ACCESS_KEY_ID && R2_SECRET_ACCESS_KEY);
}

function getR2Client(): S3Client | null {
  if (!isR2Configured()) return null;
  if (r2ClientSingleton !== undefined) return r2ClientSingleton;
  r2ClientSingleton = new S3Client({
    region: R2_REGION,
    endpoint: R2_ENDPOINT,
    forcePathStyle: true,
    credentials: {
      accessKeyId: R2_ACCESS_KEY_ID,
      secretAccessKey: R2_SECRET_ACCESS_KEY,
    },
  });
  return r2ClientSingleton;
}

function buildObjectKey(input: { salonId: number; batchId: string; fileName: string }) {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const safeFile = input.fileName.replace(/[^a-zA-Z0-9._-]+/g, '-').toLowerCase().slice(0, 80) || 'file';
  return `imports/${input.salonId}/${input.batchId}/${stamp}-${safeFile}`;
}

function buildPublicUrl(objectKey: string) {
  return `${IMPORTS_PUBLIC_BASE_URL.replace(/\/+$/, '')}/${objectKey}`;
}

async function objectBodyToBuffer(body: any): Promise<Buffer> {
  if (!body) return Buffer.alloc(0);
  if (Buffer.isBuffer(body)) return body;
  if (typeof body.transformToByteArray === 'function') {
    const bytes = await body.transformToByteArray();
    return Buffer.from(bytes);
  }
  if (typeof body.arrayBuffer === 'function') {
    const arr = await body.arrayBuffer();
    return Buffer.from(arr);
  }
  const chunks: Buffer[] = [];
  return new Promise((resolve, reject) => {
    body.on('data', (chunk: Buffer | string) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
    body.on('error', reject);
    body.on('end', () => resolve(Buffer.concat(chunks)));
  });
}

async function readSourceBuffer(input: { objectKey: string | null; publicUrl: string | null }) {
  const client = getR2Client();
  if (client && R2_BUCKET && input.objectKey) {
    const response = await client.send(
      new GetObjectCommand({
        Bucket: R2_BUCKET,
        Key: input.objectKey,
      }),
    );
    return objectBodyToBuffer(response.Body);
  }
  if (!input.publicUrl) throw new Error('source_file_not_reachable');
  const response = await fetch(input.publicUrl);
  if (!response.ok) throw new Error(`source_file_fetch_failed_${response.status}`);
  const arr = await response.arrayBuffer();
  return Buffer.from(arr);
}

function parseDateKey(value: unknown): string | null {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value.toISOString().slice(0, 10);
  if (typeof value === 'number' && Number.isFinite(value) && value >= 20000 && value <= 80000) {
    const date = new Date(Math.round((value - 25569) * DAY_MS));
    return Number.isNaN(date.getTime()) ? null : date.toISOString().slice(0, 10);
  }
  const text = normalizeText(value);
  if (!text) return null;

  const dmy = text.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{2,4})$/);
  if (dmy) {
    const day = Number(dmy[1]);
    const month = Number(dmy[2]);
    let year = Number(dmy[3]);
    if (year < 100) year += 2000;
    const date = new Date(Date.UTC(year, month - 1, day));
    return Number.isNaN(date.getTime()) ? null : date.toISOString().slice(0, 10);
  }

  const parsed = new Date(text);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString().slice(0, 10);
}

function parseMinuteOfDay(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    if (value >= 0 && value < 1) return Math.round(value * 24 * 60);
    if (value >= 0 && value < 24 * 60) return Math.floor(value);
  }
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value.getHours() * 60 + value.getMinutes();
  const text = normalizeText(value);
  if (!text) return null;
  const hhmm = text.match(/^(\d{1,2})[:.](\d{2})(?::\d{2})?$/);
  if (hhmm) {
    const h = Number(hhmm[1]);
    const m = Number(hhmm[2]);
    if (h >= 0 && h <= 23 && m >= 0 && m <= 59) return h * 60 + m;
  }
  const parsed = new Date(text);
  if (!Number.isNaN(parsed.getTime())) return parsed.getHours() * 60 + parsed.getMinutes();
  return null;
}

function minuteToHHmm(value: number | null): string | null {
  if (!Number.isInteger(value)) return null;
  const minute = Math.max(0, Math.min(24 * 60 - 1, Number(value)));
  const h = Math.floor(minute / 60);
  const m = minute % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

function buildDateTime(dateKey: string | null, minute: number | null): Date | null {
  if (!dateKey || !Number.isInteger(minute)) return null;
  const h = Math.floor(Number(minute) / 60);
  const m = Number(minute) % 60;
  const d = new Date(`${dateKey}T${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:00.000Z`);
  return Number.isNaN(d.getTime()) ? null : d;
}

function parseCsvRows(buffer: Buffer): ParsedInputRow[] {
  const rows = csvParse(buffer, {
    columns: true,
    bom: true,
    skip_empty_lines: true,
    trim: true,
    relax_column_count: true,
  }) as Array<Record<string, unknown>>;
  return rows.map((raw, idx) => ({
    rowIndex: idx + 1,
    sourceType: 'CSV',
    raw,
    confidence: null,
  }));
}

function parseExcelRows(buffer: Buffer): ParsedInputRow[] {
  const workbook = XLSX.read(buffer, {
    type: 'buffer',
    raw: false,
    cellDates: true,
  });
  const out: ParsedInputRow[] = [];
  let rowIndex = 1;
  for (const sheetName of workbook.SheetNames) {
    const sheet = workbook.Sheets[sheetName];
    if (!sheet) continue;
    const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: '', raw: false });
    for (const raw of rows) {
      out.push({
        rowIndex,
        sourceType: 'EXCEL',
        raw: { ...raw, _sheet: sheetName },
        confidence: null,
      });
      rowIndex += 1;
    }
  }
  return out;
}

function pickByAliases(row: Record<string, unknown>, key: keyof typeof ALIASES): unknown {
  const map = new Map<string, unknown>();
  for (const [k, v] of Object.entries(row)) {
    map.set(normalizeHeader(k), v);
  }
  for (const alias of ALIASES[key]) {
    if (map.has(alias)) return map.get(alias);
  }
  return undefined;
}

function hashRow(batchId: string, sourceType: ImportSourceType, rowIndex: number, normalized: Record<string, unknown>) {
  return createHash('sha256')
    .update(JSON.stringify({ batchId, sourceType, rowIndex, normalized }))
    .digest('hex');
}

async function buildAutoMaps(salonId: number, parsedRows: ParsedInputRow[]) {
  const [services, staff] = await Promise.all([
    prisma.service.findMany({
      where: { salonId },
      select: { id: true, name: true },
    }),
    prisma.staff.findMany({
      where: { salonId },
      select: { id: true, name: true },
    }),
  ]);

  const serviceMap = new Map<string, number>();
  for (const item of services) {
    const key = normalizeNameKey(item.name);
    if (key && !serviceMap.has(key)) serviceMap.set(key, item.id);
  }

  const staffMap = new Map<string, number>();
  for (const item of staff) {
    const key = normalizeNameKey(item.name);
    if (key && !staffMap.has(key)) staffMap.set(key, item.id);
  }

  const candidatePhones = new Set<string>();
  for (const row of parsedRows) {
    const phone = normalizeDigitsOnly(String(pickByAliases(row.raw, 'customerPhoneRaw') || ''));
    if (!phone) continue;
    candidatePhones.add(phone);
    candidatePhones.add(`+${phone}`);
  }

  const customers = candidatePhones.size
    ? await prisma.customer.findMany({
        where: { salonId, phone: { in: Array.from(candidatePhones) } },
        select: { id: true, phone: true },
      })
    : [];
  const customerMap = new Map<string, number>();
  for (const customer of customers) {
    const key = normalizeDigitsOnly(customer.phone);
    if (key && !customerMap.has(key)) customerMap.set(key, customer.id);
  }

  return { serviceMap, staffMap, customerMap };
}

function normalizeRows(input: {
  batchId: string;
  parsedRows: ParsedInputRow[];
  serviceMap: Map<string, number>;
  staffMap: Map<string, number>;
  customerMap: Map<string, number>;
}): NormalizedImportRow[] {
  const earliestAllowed = Date.now() - 365 * DAY_MS;
  return input.parsedRows.map((row) => {
    const customerName = normalizeText(pickByAliases(row.raw, 'customerName')) || null;
    const customerPhoneRaw = normalizeText(pickByAliases(row.raw, 'customerPhoneRaw')) || null;
    const customerPhoneNormalized = normalizeDigitsOnly(customerPhoneRaw || '') || null;
    const dateKey = parseDateKey(pickByAliases(row.raw, 'appointmentDate'));
    const startMinute = parseMinuteOfDay(pickByAliases(row.raw, 'startTime'));
    const endFromInput = parseMinuteOfDay(pickByAliases(row.raw, 'endTime'));
    const durationParsed = Number(pickByAliases(row.raw, 'durationMinutes'));
    const durationMinutes =
      Number.isFinite(durationParsed) && durationParsed > 0 ? Math.floor(durationParsed) : null;
    const endMinute =
      endFromInput !== null
        ? endFromInput
        : startMinute !== null && durationMinutes !== null
          ? startMinute + durationMinutes
          : null;
    const serviceNameRaw = normalizeText(pickByAliases(row.raw, 'serviceNameRaw')) || null;
    const staffNameRaw = normalizeText(pickByAliases(row.raw, 'staffNameRaw')) || null;
    const notesRaw = normalizeText(pickByAliases(row.raw, 'notesRaw')) || null;
    const rawPrice = pickByAliases(row.raw, 'priceRaw');
    const priceNum = Number(
      typeof rawPrice === 'string' ? rawPrice.replace(/[^\d.,-]/g, '').replace(',', '.') : rawPrice,
    );
    const priceRaw = Number.isFinite(priceNum) ? priceNum : null;
    const confidenceNum = Number(pickByAliases(row.raw, 'confidence'));
    const confidence = Number.isFinite(confidenceNum) ? confidenceNum : row.confidence;
    const serviceId = serviceNameRaw ? input.serviceMap.get(normalizeNameKey(serviceNameRaw)) || null : null;
    const staffId = staffNameRaw ? input.staffMap.get(normalizeNameKey(staffNameRaw)) || null : null;
    const customerId = customerPhoneNormalized ? input.customerMap.get(customerPhoneNormalized) || null : null;
    const appointmentDate = dateKey ? new Date(`${dateKey}T00:00:00.000Z`) : null;

    const conflicts: NormalizedImportRow['conflicts'] = [];
    if (!customerPhoneNormalized) {
      conflicts.push({ type: 'MISSING_PHONE', message: 'Customer phone is missing.' });
    } else if (customerPhoneNormalized.length < 8 || customerPhoneNormalized.length > 15) {
      conflicts.push({ type: 'INVALID_PHONE', message: 'Customer phone is invalid.' });
    }
    if (!appointmentDate || Number.isNaN(appointmentDate.getTime())) {
      conflicts.push({ type: 'VALIDATION_ERROR', message: 'Appointment date is required.' });
    } else if (appointmentDate.getTime() < earliestAllowed) {
      conflicts.push({ type: 'OUT_OF_RANGE_DATE', message: 'Appointment date is older than 12 months.' });
    }
    if (startMinute === null) {
      conflicts.push({ type: 'VALIDATION_ERROR', message: 'Appointment start time is required.' });
    }
    if (serviceNameRaw && !serviceId) {
      conflicts.push({ type: 'SERVICE_UNMATCHED', message: `Service match not found: ${serviceNameRaw}` });
    }
    if (staffNameRaw && !staffId) {
      conflicts.push({ type: 'STAFF_UNMATCHED', message: `Staff match not found: ${staffNameRaw}` });
    }

    const normalizedData = {
      sourceType: row.sourceType,
      rowIndex: row.rowIndex,
      customerName,
      customerPhoneRaw,
      customerPhoneNormalized,
      appointmentDate: dateKey,
      startTime: minuteToHHmm(startMinute),
      endTime: minuteToHHmm(endMinute),
      durationMinutes,
      serviceNameRaw,
      staffNameRaw,
      priceRaw,
      notesRaw,
      confidence,
    };
    const rowStatus: ImportRowStatus = conflicts.length ? 'CONFLICT' : 'READY';

    return {
      rowIndex: row.rowIndex,
      sourceRowHash: hashRow(input.batchId, row.sourceType, row.rowIndex, normalizedData),
      rawData: row.raw,
      normalizedData,
      customerName,
      customerPhoneRaw,
      customerPhoneNormalized,
      appointmentDate,
      startMinute,
      endMinute,
      durationMinutes,
      serviceNameRaw,
      staffNameRaw,
      priceRaw,
      notesRaw,
      confidence,
      matchedCustomerId: customerId,
      matchedServiceId: serviceId,
      matchedStaffId: staffId,
      rowStatus,
      conflicts,
    };
  });
}

async function replaceRowsForFile(input: {
  batchId: string;
  salonId: number;
  sourceFileId: number;
  rows: NormalizedImportRow[];
}) {
  for (const row of input.rows) {
    const upserted = await prisma.importRow.upsert({
      where: {
        batchId_sourceRowHash: {
          batchId: input.batchId,
          sourceRowHash: row.sourceRowHash,
        },
      },
      update: {
        sourceFileId: input.sourceFileId,
        rowIndex: row.rowIndex,
        rowStatus: row.rowStatus,
        rawData: row.rawData as any,
        normalizedData: row.normalizedData as any,
        customerName: row.customerName,
        customerPhoneRaw: row.customerPhoneRaw,
        customerPhoneNormalized: row.customerPhoneNormalized,
        appointmentDate: row.appointmentDate,
        startMinute: row.startMinute,
        endMinute: row.endMinute,
        durationMinutes: row.durationMinutes,
        serviceNameRaw: row.serviceNameRaw,
        staffNameRaw: row.staffNameRaw,
        priceRaw: row.priceRaw,
        notesRaw: row.notesRaw,
        confidence: row.confidence,
        matchedCustomerId: row.matchedCustomerId,
        matchedServiceId: row.matchedServiceId,
        matchedStaffId: row.matchedStaffId,
        importedAppointmentId: null,
        failureReason: null,
      },
      create: {
        batchId: input.batchId,
        salonId: input.salonId,
        sourceFileId: input.sourceFileId,
        rowIndex: row.rowIndex,
        sourceRowHash: row.sourceRowHash,
        rowStatus: row.rowStatus,
        rawData: row.rawData as any,
        normalizedData: row.normalizedData as any,
        customerName: row.customerName,
        customerPhoneRaw: row.customerPhoneRaw,
        customerPhoneNormalized: row.customerPhoneNormalized,
        appointmentDate: row.appointmentDate,
        startMinute: row.startMinute,
        endMinute: row.endMinute,
        durationMinutes: row.durationMinutes,
        serviceNameRaw: row.serviceNameRaw,
        staffNameRaw: row.staffNameRaw,
        priceRaw: row.priceRaw,
        notesRaw: row.notesRaw,
        confidence: row.confidence,
        matchedCustomerId: row.matchedCustomerId,
        matchedServiceId: row.matchedServiceId,
        matchedStaffId: row.matchedStaffId,
      },
      select: { id: true },
    });

    await prisma.importConflict.deleteMany({
      where: {
        batchId: input.batchId,
        rowId: upserted.id,
      },
    });

    if (row.conflicts.length > 0) {
      await prisma.importConflict.createMany({
        data: row.conflicts.map((conflict) => ({
          batchId: input.batchId,
          rowId: upserted.id,
          salonId: input.salonId,
          type: conflict.type,
          status: 'OPEN',
          message: conflict.message,
          payload: conflict.payload ? (conflict.payload as any) : undefined,
        })),
      });
    }
  }
}

async function buildBatchSummary(batchId: string) {
  const [fileGroups, rowGroups, conflictGroups] = await Promise.all([
    prisma.importSourceFile.groupBy({
      by: ['status'],
      where: { batchId },
      _count: { _all: true },
    }),
    prisma.importRow.groupBy({
      by: ['rowStatus'],
      where: { batchId },
      _count: { _all: true },
    }),
    prisma.importConflict.groupBy({
      by: ['status'],
      where: { batchId },
      _count: { _all: true },
    }),
  ]);

  const filesByStatus: Record<string, number> = {};
  for (const item of fileGroups) filesByStatus[item.status] = item._count._all;
  const rowsByStatus: Record<string, number> = {};
  for (const item of rowGroups) rowsByStatus[item.rowStatus] = item._count._all;
  const conflictsByStatus: Record<string, number> = {};
  for (const item of conflictGroups) conflictsByStatus[item.status] = item._count._all;

  return {
    totalFiles: fileGroups.reduce((acc, item) => acc + item._count._all, 0),
    filesByStatus,
    totalRows: rowGroups.reduce((acc, item) => acc + item._count._all, 0),
    rowsByStatus,
    totalConflicts: conflictGroups.reduce((acc, item) => acc + item._count._all, 0),
    openConflicts: conflictsByStatus.OPEN || 0,
    resolvedConflicts: conflictsByStatus.RESOLVED || 0,
    ignoredConflicts: conflictsByStatus.IGNORED || 0,
    updatedAt: new Date().toISOString(),
  };
}

async function refreshBatchStatus(batchId: string) {
  const [batch, pendingFileCount, summary] = await Promise.all([
    prisma.importBatch.findUnique({
      where: { id: batchId },
      select: { id: true, status: true },
    }),
    prisma.importSourceFile.count({
      where: {
        batchId,
        status: { in: ['PENDING_UPLOAD', 'PARSING', 'WAITING_OCR'] },
      },
    }),
    buildBatchSummary(batchId),
  ]);

  if (!batch) return;
  if (batch.status === 'COMMITTING' || batch.status === 'COMPLETED' || batch.status === 'FAILED') {
    await prisma.importBatch.update({
      where: { id: batchId },
      data: { summary: summary as any },
    });
    return;
  }

  let status = batch.status;
  if (pendingFileCount > 0) {
    status = status === 'UPLOADING' ? 'UPLOADING' : 'PARSING';
  } else if (summary.totalRows === 0 || summary.openConflicts > 0) {
    status = 'NEEDS_REVIEW';
  } else {
    status = 'READY_TO_COMMIT';
  }

  await prisma.importBatch.update({
    where: { id: batchId },
    data: {
      status,
      summary: summary as any,
    },
  });
}

export async function createImportBatch(input: { salonId: number; userId: number }) {
  await assertImportPrerequisites(input.salonId);
  return prisma.importBatch.create({
    data: {
      salonId: input.salonId,
      createdByUserId: input.userId,
      status: 'UPLOADING',
      startedAt: new Date(),
      summary: {
        totalFiles: 0,
        totalRows: 0,
        totalConflicts: 0,
        openConflicts: 0,
      } as any,
    },
    select: {
      id: true,
      status: true,
      createdAt: true,
      updatedAt: true,
      summary: true,
    },
  });
}

export async function createImportFilePresign(input: {
  salonId: number;
  batchId: string;
  fileName: string;
  mimeType?: string | null;
  sizeBytes?: number | null;
}) {
  const batch = await prisma.importBatch.findFirst({
    where: { id: input.batchId, salonId: input.salonId },
    select: { id: true, status: true },
  });
  if (!batch) throw new Error('batch_not_found');
  if (!['UPLOADING', 'PARSING', 'NEEDS_REVIEW', 'READY_TO_COMMIT'].includes(batch.status)) {
    throw new Error('batch_not_open_for_upload');
  }

  const sourceType = inferSourceType({ fileName: input.fileName, mimeType: input.mimeType });
  const objectKey = buildObjectKey({
    salonId: input.salonId,
    batchId: input.batchId,
    fileName: input.fileName,
  });
  const publicUrl = buildPublicUrl(objectKey);

  const file = await prisma.importSourceFile.create({
    data: {
      batchId: input.batchId,
      salonId: input.salonId,
      sourceType,
      status: 'PENDING_UPLOAD',
      originalFileName: input.fileName,
      mimeType: input.mimeType || null,
      sizeBytes: Number.isFinite(Number(input.sizeBytes)) ? Number(input.sizeBytes) : null,
      objectKey,
      publicUrl,
    },
    select: { id: true, sourceType: true, objectKey: true, publicUrl: true, status: true },
  });

  await prisma.importBatch.update({
    where: { id: input.batchId },
    data: { status: 'UPLOADING' },
  });

  const client = getR2Client();
  if (!client || !R2_BUCKET) {
    return {
      file,
      upload: {
        mode: 'EXTERNAL',
        uploadUrl: null,
        method: 'PUT',
        headers: {},
        expiresInSeconds: PRESIGN_TTL_SECONDS,
      },
    };
  }

  const command = new PutObjectCommand({
    Bucket: R2_BUCKET,
    Key: objectKey,
    ContentType: input.mimeType || undefined,
  });
  const uploadUrl = await getSignedUrl(client, command, { expiresIn: PRESIGN_TTL_SECONDS });

  return {
    file,
    upload: {
      mode: 'PRESIGNED_PUT',
      uploadUrl,
      method: 'PUT',
      headers: input.mimeType ? { 'Content-Type': input.mimeType } : {},
      expiresInSeconds: PRESIGN_TTL_SECONDS,
    },
  };
}

async function parseFileRows(input: {
  sourceType: ImportSourceType;
  objectKey: string | null;
  publicUrl: string | null;
}) {
  if (input.sourceType === 'PDF' || input.sourceType === 'IMAGE') {
    return { rows: [] as ParsedInputRow[], warnings: ['source_requires_ocr_callback'] };
  }

  const buffer = await readSourceBuffer({ objectKey: input.objectKey, publicUrl: input.publicUrl });
  const rows = input.sourceType === 'CSV' ? parseCsvRows(buffer) : parseExcelRows(buffer);
  return { rows, warnings: [] as string[] };
}

export async function completeImportSourceFile(input: {
  salonId: number;
  batchId: string;
  fileId: number;
  objectKey?: string | null;
  publicUrl?: string | null;
}) {
  const file = await prisma.importSourceFile.findFirst({
    where: {
      id: input.fileId,
      batchId: input.batchId,
      salonId: input.salonId,
    },
    select: {
      id: true,
      sourceType: true,
      objectKey: true,
      publicUrl: true,
    },
  });
  if (!file) throw new Error('source_file_not_found');

  await prisma.importSourceFile.update({
    where: { id: file.id },
    data: {
      objectKey: input.objectKey || file.objectKey,
      publicUrl: input.publicUrl || file.publicUrl,
      status: file.sourceType === 'PDF' || file.sourceType === 'IMAGE' ? 'WAITING_OCR' : 'PARSING',
      uploadedAt: new Date(),
      extractionError: null,
    },
  });

  await prisma.importBatch.update({
    where: { id: input.batchId },
    data: { status: 'PARSING' },
  });

  if (file.sourceType === 'PDF' || file.sourceType === 'IMAGE') {
    await refreshBatchStatus(input.batchId);
    return { fileId: file.id, status: 'WAITING_OCR', parsedRowCount: 0, queuedForOcr: true, warnings: [] as string[] };
  }

  const parsed = await parseFileRows({
    sourceType: file.sourceType,
    objectKey: input.objectKey || file.objectKey,
    publicUrl: input.publicUrl || file.publicUrl,
  });
  const maps = await buildAutoMaps(input.salonId, parsed.rows);
  const normalized = normalizeRows({
    batchId: input.batchId,
    parsedRows: parsed.rows,
    serviceMap: maps.serviceMap,
    staffMap: maps.staffMap,
    customerMap: maps.customerMap,
  });

  await replaceRowsForFile({
    batchId: input.batchId,
    salonId: input.salonId,
    sourceFileId: file.id,
    rows: normalized,
  });

  await prisma.importSourceFile.update({
    where: { id: file.id },
    data: {
      status: 'PARSED',
      parsedAt: new Date(),
      extractionError: null,
    },
  });

  await refreshBatchStatus(input.batchId);

  return {
    fileId: file.id,
    status: 'PARSED',
    parsedRowCount: normalized.length,
    queuedForOcr: false,
    warnings: parsed.warnings,
  };
}

export async function processImportOcrCallback(input: {
  batchId: string;
  sourceFileId: number;
  extractionError?: string | null;
  rows?: Array<Record<string, unknown>>;
}) {
  const file = await prisma.importSourceFile.findFirst({
    where: { id: input.sourceFileId, batchId: input.batchId },
    select: { id: true, salonId: true, sourceType: true },
  });
  if (!file) throw new Error('source_file_not_found');

  if (input.extractionError) {
    await prisma.importSourceFile.update({
      where: { id: file.id },
      data: { status: 'FAILED_EXTRACTION', extractionError: input.extractionError.slice(0, 800) },
    });
    await refreshBatchStatus(input.batchId);
    return { ok: false, parsedRowCount: 0 };
  }

  const parsedRows: ParsedInputRow[] = (Array.isArray(input.rows) ? input.rows : []).map((raw, idx) => ({
    rowIndex: Number(raw?.rowIndex) > 0 ? Number(raw.rowIndex) : idx + 1,
    sourceType: file.sourceType,
    raw,
    confidence: Number.isFinite(Number(raw?.confidence)) ? Number(raw.confidence) : null,
  }));

  const maps = await buildAutoMaps(file.salonId, parsedRows);
  const normalized = normalizeRows({
    batchId: input.batchId,
    parsedRows,
    serviceMap: maps.serviceMap,
    staffMap: maps.staffMap,
    customerMap: maps.customerMap,
  });
  await replaceRowsForFile({
    batchId: input.batchId,
    salonId: file.salonId,
    sourceFileId: file.id,
    rows: normalized,
  });

  await prisma.importSourceFile.update({
    where: { id: file.id },
    data: {
      status: 'PARSED',
      parsedAt: new Date(),
      extractionError: null,
    },
  });
  await refreshBatchStatus(input.batchId);
  return { ok: true, parsedRowCount: normalized.length };
}

export async function getImportBatchState(input: { salonId: number; batchId: string }) {
  const batch = await prisma.importBatch.findFirst({
    where: { id: input.batchId, salonId: input.salonId },
    include: {
      files: { orderBy: { id: 'asc' } },
      commitRuns: { orderBy: { id: 'desc' }, take: 5 },
    },
  });
  if (!batch) throw new Error('batch_not_found');
  return batch;
}

export async function getImportPreview(input: { salonId: number; batchId: string; limitRows?: number }) {
  const take = Math.max(20, Math.min(500, Number(input.limitRows) || 200));
  const [batch, rows, conflicts, services, staff] = await Promise.all([
    prisma.importBatch.findFirst({
      where: { id: input.batchId, salonId: input.salonId },
      select: { id: true, status: true, summary: true, createdAt: true, updatedAt: true },
    }),
    prisma.importRow.findMany({
      where: { batchId: input.batchId, salonId: input.salonId },
      orderBy: [{ rowStatus: 'asc' }, { rowIndex: 'asc' }],
      take,
      select: {
        id: true,
        rowIndex: true,
        rowStatus: true,
        normalizedData: true,
        customerName: true,
        customerPhoneRaw: true,
        customerPhoneNormalized: true,
        appointmentDate: true,
        startMinute: true,
        endMinute: true,
        durationMinutes: true,
        serviceNameRaw: true,
        staffNameRaw: true,
        priceRaw: true,
        notesRaw: true,
        confidence: true,
        matchedCustomerId: true,
        matchedServiceId: true,
        matchedStaffId: true,
        importedAppointmentId: true,
        failureReason: true,
      },
    }),
    prisma.importConflict.findMany({
      where: { batchId: input.batchId, salonId: input.salonId },
      orderBy: [{ status: 'asc' }, { id: 'asc' }],
      take: 600,
    }),
    prisma.service.findMany({
      where: { salonId: input.salonId },
      select: { id: true, name: true, duration: true, price: true },
      orderBy: { name: 'asc' },
    }),
    prisma.staff.findMany({
      where: { salonId: input.salonId },
      select: { id: true, name: true, title: true },
      orderBy: { name: 'asc' },
    }),
  ]);
  if (!batch) throw new Error('batch_not_found');
  return { batch, rows, conflicts, mappingOptions: { services, staff } };
}

export async function saveImportMappingDecisions(input: {
  salonId: number;
  batchId: string;
  userId: number;
  decisions: Array<{
    rowId?: number | null;
    conflictId?: number | null;
    decisionType: string;
    decisionKey: string;
    decisionValue: unknown;
  }>;
}) {
  const batch = await prisma.importBatch.findFirst({
    where: { id: input.batchId, salonId: input.salonId },
    select: { id: true },
  });
  if (!batch) throw new Error('batch_not_found');

  for (const decision of input.decisions) {
    const rowId = Number(decision.rowId);
    const conflictId = Number(decision.conflictId);
    const patch = asObject(decision.decisionValue);

    await prisma.importMappingDecision.create({
      data: {
        batchId: input.batchId,
        rowId: Number.isInteger(rowId) && rowId > 0 ? rowId : null,
        salonId: input.salonId,
        userId: input.userId,
        decisionType: String(decision.decisionType || 'MANUAL_PATCH').slice(0, 120),
        decisionKey: String(decision.decisionKey || 'manual').slice(0, 120),
        decisionValue: patch as any,
      },
    });

    if (Number.isInteger(rowId) && rowId > 0) {
      const matchedServiceId = Number(patch.matchedServiceId);
      const matchedStaffId = Number(patch.matchedStaffId);
      const normalizedPhone = normalizeDigitsOnly(String(patch.customerPhoneNormalized || patch.customerPhone || ''));
      await prisma.importRow.updateMany({
        where: { id: rowId, batchId: input.batchId, salonId: input.salonId },
        data: {
          ...(Number.isInteger(matchedServiceId) && matchedServiceId > 0 ? { matchedServiceId } : {}),
          ...(Number.isInteger(matchedStaffId) && matchedStaffId > 0 ? { matchedStaffId } : {}),
          ...(normalizedPhone ? { customerPhoneNormalized: normalizedPhone } : {}),
        },
      });
    }

    if (Number.isInteger(conflictId) && conflictId > 0) {
      await prisma.importConflict.updateMany({
        where: { id: conflictId, batchId: input.batchId, salonId: input.salonId },
        data: {
          status: patch.ignoreConflict === true ? 'IGNORED' : 'RESOLVED',
          resolvedAt: new Date(),
          resolvedByUserId: input.userId,
        },
      });
    }
  }

  const rows = await prisma.importRow.findMany({
    where: { batchId: input.batchId, salonId: input.salonId },
    select: { id: true, matchedServiceId: true, matchedStaffId: true, customerPhoneNormalized: true },
  });

  for (const row of rows) {
    const openConflicts = await prisma.importConflict.count({
      where: { batchId: input.batchId, rowId: row.id, status: 'OPEN' },
    });
    const isReady =
      openConflicts === 0 &&
      Boolean(row.customerPhoneNormalized) &&
      Boolean(row.matchedServiceId) &&
      Boolean(row.matchedStaffId);
    await prisma.importRow.update({
      where: { id: row.id },
      data: { rowStatus: isReady ? 'READY' : 'CONFLICT' },
    });
  }

  await refreshBatchStatus(input.batchId);
  return { ok: true };
}

async function ensureServiceForRow(salonId: number, row: {
  matchedServiceId: number | null;
  serviceNameRaw: string | null;
  durationMinutes: number | null;
  priceRaw: number | null;
}) {
  if (row.matchedServiceId) return row.matchedServiceId;
  if (!row.serviceNameRaw) return null;

  const existing = await prisma.service.findFirst({
    where: { salonId, name: { equals: row.serviceNameRaw, mode: 'insensitive' } },
    select: { id: true },
  });
  if (existing) return existing.id;

  const created = await prisma.service.create({
    data: {
      salonId,
      name: row.serviceNameRaw.trim(),
      isActive: true,
      requiresSpecialist: true,
      duration: Math.max(5, Math.min(600, row.durationMinutes || 30)),
      price: Number.isFinite(row.priceRaw || NaN) ? Number(row.priceRaw) : 0,
    },
    select: { id: true },
  });
  return created.id;
}

async function ensureStaffForRow(salonId: number, row: {
  matchedStaffId: number | null;
  staffNameRaw: string | null;
}) {
  if (row.matchedStaffId) return row.matchedStaffId;
  if (!row.staffNameRaw) return null;

  const existing = await prisma.staff.findFirst({
    where: { salonId, name: { equals: row.staffNameRaw, mode: 'insensitive' } },
    select: { id: true },
  });
  if (existing) return existing.id;

  const created = await prisma.staff.create({
    data: {
      salonId,
      name: row.staffNameRaw.trim(),
    },
    select: { id: true },
  });
  return created.id;
}

async function ensureStaffService(staffId: number, serviceId: number, duration: number, price: number) {
  const normalizedDuration = Math.max(5, Math.min(600, duration || 30));
  const normalizedPrice = Number.isFinite(price) ? price : 0;
  const existing = await prisma.staffService.findFirst({
    where: {
      staffId,
      serviceId,
      gender: 'female',
    },
    select: { id: true },
  });
  if (existing) {
    await prisma.staffService.update({
      where: { id: existing.id },
      data: {
        isactive: true,
        duration: normalizedDuration,
        price: normalizedPrice,
      },
    });
    return;
  }
  await prisma.staffService.create({
    data: {
      staffId,
      serviceId,
      gender: 'female',
      isactive: true,
      duration: normalizedDuration,
      price: normalizedPrice,
    },
  });
}

async function ensureCustomer(salonId: number, phoneDigits: string, name: string | null) {
  const existing = await prisma.customer.findFirst({
    where: { salonId, phone: { in: [phoneDigits, `+${phoneDigits}`] } },
    select: { id: true, name: true, phone: true, gender: true },
  });
  if (existing) {
    if (!existing.name && name) {
      return prisma.customer.update({
        where: { id: existing.id },
        data: { name },
        select: { id: true, name: true, phone: true, gender: true },
      });
    }
    return existing;
  }

  const created = await prisma.customer.create({
    data: {
      salonId,
      phone: phoneDigits,
      name: name || null,
      registrationStatus: 'PENDING',
      acceptMarketing: false,
    },
    select: { id: true, name: true, phone: true, gender: true },
  });
  await prisma.customerRiskProfile
    .create({
      data: {
        salonId,
        customerId: created.id,
        riskScore: 0,
      },
    })
    .catch(() => undefined);
  return created;
}

export async function commitImportBatch(input: {
  salonId: number;
  batchId: string;
  userId: number;
}) {
  const batch = await prisma.importBatch.findFirst({
    where: { id: input.batchId, salonId: input.salonId },
    select: { id: true, status: true },
  });
  if (!batch) throw new Error('batch_not_found');
  if (batch.status === 'COMPLETED') {
    const latest = await prisma.importCommitRun.findFirst({
      where: { batchId: input.batchId, salonId: input.salonId },
      orderBy: { id: 'desc' },
    });
    return { idempotent: true, run: latest };
  }
  if (batch.status === 'COMMITTING') throw new Error('commit_already_running');

  await prisma.importBatch.update({
    where: { id: input.batchId },
    data: { status: 'COMMITTING' },
  });

  const run = await prisma.importCommitRun.create({
    data: {
      batchId: input.batchId,
      salonId: input.salonId,
      triggeredByUserId: input.userId,
      status: 'RUNNING',
      startedAt: new Date(),
      summary: {
        totalRows: 0,
        imported: 0,
        conflicts: 0,
        failed: 0,
        skipped: 0,
      } as any,
    },
  });

  try {
    const unresolved = await prisma.importConflict.count({
      where: { batchId: input.batchId, salonId: input.salonId, status: 'OPEN' },
    });
    if (unresolved > 0) throw new Error('open_conflicts_remaining');

    const rows = await prisma.importRow.findMany({
      where: { batchId: input.batchId, salonId: input.salonId, rowStatus: { in: ['READY', 'CONFLICT'] } },
      orderBy: [{ rowStatus: 'asc' }, { id: 'asc' }],
    });

    let imported = 0;
    let conflicts = 0;
    let failed = 0;
    let skipped = 0;

    for (const row of rows) {
      try {
        const serviceId = await ensureServiceForRow(input.salonId, row);
        const staffId = await ensureStaffForRow(input.salonId, row);

        if (!row.customerPhoneNormalized || !serviceId || !staffId) {
          await prisma.importRow.update({
            where: { id: row.id },
            data: {
              rowStatus: 'CONFLICT',
              matchedServiceId: serviceId,
              matchedStaffId: staffId,
              failureReason: 'missing_required_matches',
            },
          });
          await prisma.importConflict.create({
            data: {
              batchId: input.batchId,
              rowId: row.id,
              salonId: input.salonId,
              type: 'VALIDATION_ERROR',
              status: 'OPEN',
              message: 'Row requires service, staff and valid phone.',
            },
          });
          conflicts += 1;
          continue;
        }

        const service = await prisma.service.findFirst({
          where: { id: serviceId, salonId: input.salonId },
          select: { id: true, duration: true, price: true },
        });
        if (!service) {
          await prisma.importRow.update({
            where: { id: row.id },
            data: { rowStatus: 'FAILED', failureReason: 'service_not_found' },
          });
          failed += 1;
          continue;
        }

        const startMinute = row.startMinute ?? 9 * 60;
        const duration = Math.max(5, Math.min(600, row.durationMinutes || service.duration || 30));
        const endMinute = row.endMinute && row.endMinute > startMinute ? row.endMinute : startMinute + duration;
        const dateKey = row.appointmentDate ? row.appointmentDate.toISOString().slice(0, 10) : null;
        const startTime = buildDateTime(dateKey, startMinute);
        const endTime = buildDateTime(dateKey, endMinute);
        if (!startTime || !endTime) {
          await prisma.importRow.update({
            where: { id: row.id },
            data: { rowStatus: 'FAILED', failureReason: 'invalid_date_or_time' },
          });
          failed += 1;
          continue;
        }

        await ensureStaffService(staffId, serviceId, duration, Number.isFinite(row.priceRaw || NaN) ? Number(row.priceRaw) : service.price);

        const overlap = await prisma.appointment.findFirst({
          where: {
            salonId: input.salonId,
            staffId,
            status: { in: ['BOOKED'] },
            startTime: { lt: endTime },
            endTime: { gt: startTime },
          },
          select: { id: true, startTime: true, endTime: true },
        });
        if (overlap) {
          await prisma.importRow.update({
            where: { id: row.id },
            data: { rowStatus: 'CONFLICT', failureReason: 'staff_overlap' },
          });
          await prisma.importConflict.create({
            data: {
              batchId: input.batchId,
              rowId: row.id,
              salonId: input.salonId,
              type: 'APPOINTMENT_OVERLAP',
              status: 'OPEN',
              message: 'Staff has an overlapping appointment.',
              payload: {
                conflictingAppointmentId: overlap.id,
                conflictingStartTime: overlap.startTime.toISOString(),
                conflictingEndTime: overlap.endTime.toISOString(),
              } as any,
            },
          });
          conflicts += 1;
          continue;
        }

        const customer = await ensureCustomer(input.salonId, row.customerPhoneNormalized, row.customerName);
        const appointment = await prisma.appointment.create({
          data: {
            salonId: input.salonId,
            customerId: customer.id,
            customerName: row.customerName || customer.name || 'Misafir',
            customerPhone: customer.phone,
            serviceId,
            staffId,
            startTime,
            endTime,
            status: startTime.getTime() < Date.now() ? 'COMPLETED' : 'BOOKED',
            source: 'ADMIN',
            notes: row.notesRaw || null,
            gender: customer.gender || 'female',
            listPrice: service.price,
            finalPrice: Number.isFinite(row.priceRaw || NaN) ? Number(row.priceRaw) : service.price,
          },
          select: { id: true },
        });

        await prisma.importRow.update({
          where: { id: row.id },
          data: {
            rowStatus: 'IMPORTED',
            matchedCustomerId: customer.id,
            matchedServiceId: serviceId,
            matchedStaffId: staffId,
            importedAppointmentId: appointment.id,
            failureReason: null,
          },
        });
        imported += 1;
      } catch (error: any) {
        await prisma.importRow.update({
          where: { id: row.id },
          data: {
            rowStatus: 'FAILED',
            failureReason: error instanceof Error ? error.message.slice(0, 500) : 'unknown_error',
          },
        });
        failed += 1;
      }
    }

    const summary = {
      totalRows: rows.length,
      imported,
      conflicts,
      failed,
      skipped,
      completedAt: new Date().toISOString(),
    };

    await prisma.importCommitRun.update({
      where: { id: run.id },
      data: {
        status: conflicts || failed || skipped ? 'PARTIAL_FAILED' : 'COMPLETED',
        completedAt: new Date(),
        summary: summary as any,
      },
    });
    await prisma.importBatch.update({
      where: { id: input.batchId },
      data: {
        status: 'COMPLETED',
        completedAt: new Date(),
      },
    });
    await refreshBatchStatus(input.batchId);
    return { idempotent: false, runId: run.id, summary };
  } catch (error: any) {
    await prisma.importCommitRun.update({
      where: { id: run.id },
      data: {
        status: 'FAILED',
        completedAt: new Date(),
        summary: {
          error: error instanceof Error ? error.message : 'unknown_error',
          failedAt: new Date().toISOString(),
        } as any,
      },
    });
    await prisma.importBatch.update({
      where: { id: input.batchId },
      data: { status: 'FAILED', completedAt: new Date() },
    });
    await refreshBatchStatus(input.batchId);
    throw error;
  }
}

export async function getImportReport(input: { salonId: number; batchId: string }) {
  const [batch, latestRun, rowGroups, conflictGroups] = await Promise.all([
    prisma.importBatch.findFirst({
      where: { id: input.batchId, salonId: input.salonId },
      select: { id: true, status: true, summary: true, createdAt: true, completedAt: true },
    }),
    prisma.importCommitRun.findFirst({
      where: { batchId: input.batchId, salonId: input.salonId },
      orderBy: { id: 'desc' },
    }),
    prisma.importRow.groupBy({
      by: ['rowStatus'],
      where: { batchId: input.batchId, salonId: input.salonId },
      _count: { _all: true },
    }),
    prisma.importConflict.groupBy({
      by: ['status'],
      where: { batchId: input.batchId, salonId: input.salonId },
      _count: { _all: true },
    }),
  ]);
  if (!batch) throw new Error('batch_not_found');

  const rows: Record<string, number> = {};
  for (const item of rowGroups) rows[item.rowStatus] = item._count._all;
  const conflicts: Record<string, number> = {};
  for (const item of conflictGroups) conflicts[item.status] = item._count._all;
  return { batch, latestRun, rows, conflicts };
}

export async function cleanupExpiredImportData(now = new Date()) {
  const cutoff = new Date(now.getTime() - IMPORT_RETENTION_DAYS * DAY_MS);
  const oldFiles = await prisma.importSourceFile.findMany({
    where: {
      createdAt: { lt: cutoff },
      objectKey: { not: null },
    },
    select: { objectKey: true },
    take: 1000,
  });

  const client = getR2Client();
  if (client && R2_BUCKET) {
    for (const file of oldFiles) {
      if (!file.objectKey) continue;
      try {
        await client.send(
          new DeleteObjectCommand({
            Bucket: R2_BUCKET,
            Key: file.objectKey,
          }),
        );
      } catch (error) {
        console.warn('Import object cleanup warning:', file.objectKey, error);
      }
    }
  }

  const deleted = await prisma.importBatch.deleteMany({
    where: { createdAt: { lt: cutoff } },
  });
  return {
    cutoff: cutoff.toISOString(),
    deletedBatchCount: deleted.count,
    attemptedObjectDeleteCount: oldFiles.length,
  };
}

export function startImportRetentionJob() {
  if (retentionTimer) return;
  const run = () => {
    cleanupExpiredImportData().catch((error) => {
      console.error('Import retention cleanup error:', error);
    });
  };
  run();
  retentionTimer = setInterval(run, 24 * 60 * 60 * 1000);
  retentionTimer.unref?.();
}
