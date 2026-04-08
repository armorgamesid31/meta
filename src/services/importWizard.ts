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

const prismaAny = prisma as any;

const PRESIGN_TTL_SECONDS = Math.max(60, Number(process.env.IMPORTS_PRESIGN_TTL_SECONDS || 900));
const IMPORT_RETENTION_DAYS = Math.max(1, Number(process.env.IMPORTS_RETENTION_DAYS || 30));
const IMPORTS_OCR_WEBHOOK_URL = (process.env.IMPORTS_OCR_WEBHOOK_URL || '').trim();
const IMPORTS_OCR_BENCHMARK_WEBHOOK_URL = (
  process.env.IMPORTS_OCR_BENCHMARK_WEBHOOK_URL ||
  process.env.IMPORTS_OCR_WEBHOOK_URL ||
  ''
).trim();
const IMPORTS_OCR_WEBHOOK_TIMEOUT_MS = Math.max(3000, Number(process.env.IMPORTS_OCR_WEBHOOK_TIMEOUT_MS || 15000));
const IMPORTS_OCR_AUTO_TRIGGER = (process.env.IMPORTS_OCR_AUTO_TRIGGER || 'true').trim().toLowerCase() !== 'false';
const N8N_SHARED_INTERNAL_KEY = (process.env.N8N_INTERNAL_API_KEY || process.env.INTERNAL_API_KEY || '').trim();
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

const DEFAULT_IMPORT_AI_CONFIG = {
  ocrProvider: 'google-vision',
  ocrModel: 'DOCUMENT_TEXT_DETECTION',
  llmProvider: 'openrouter',
  llmModel: 'openai/gpt-4o-mini',
  promptVersion: 'prod-v1',
  promptLabel: 'Production Prompt',
  outputContractVersion: 'rows-v1',
} as const;

const DAY_MS = 24 * 60 * 60 * 1000;
let r2ClientSingleton: S3Client | null | undefined;
let retentionTimer: NodeJS.Timeout | null = null;

type ParsedInputRow = {
  rowIndex: number;
  sourceType: ImportSourceType;
  raw: Record<string, unknown>;
  confidence: number | null;
};

type ImportAiConfigSnapshot = {
  id: number | null;
  ocrProvider: string;
  ocrModel: string | null;
  llmProvider: string;
  llmModel: string;
  promptVersion: string;
  promptLabel: string | null;
  outputContractVersion: string;
  notesJson?: Record<string, unknown> | null;
};

type ImportExtractionCandidateInput = {
  provider?: unknown;
  model?: unknown;
  promptVersion?: unknown;
  promptLabel?: unknown;
  phase?: unknown;
  strictness?: unknown;
  temperature?: unknown;
  rawOutputText?: unknown;
  parsedRows?: unknown;
  scoreTotal?: unknown;
  scoreBreakdown?: unknown;
  errorScore?: unknown;
  hallucinationPenalty?: unknown;
  schemaViolationCount?: unknown;
  isSelected?: unknown;
};

type NormalizedEvalRow = {
  rowKey: string;
  appointmentDate: string | null;
  startTime: string | null;
  customerNameKey: string | null;
  customerNameRaw: string | null;
  services: string[];
  serviceNameRaw: string | null;
  noteTokens: string[];
};

type ImportExtractionAuditInput = {
  ocrProvider?: unknown;
  ocrModel?: unknown;
  ocrRawText?: unknown;
  phase?: unknown;
  strictness?: unknown;
  temperature?: unknown;
  activeConfigSnapshot?: unknown;
  metrics?: unknown;
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

function coerceRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function normalizeImportAiConfigSnapshot(value: unknown): ImportAiConfigSnapshot {
  const record = coerceRecord(value);
  return {
    id: Number.isInteger(Number(record?.id)) ? Number(record?.id) : null,
    ocrProvider: normalizeText(record?.ocrProvider) || DEFAULT_IMPORT_AI_CONFIG.ocrProvider,
    ocrModel: normalizeText(record?.ocrModel) || DEFAULT_IMPORT_AI_CONFIG.ocrModel,
    llmProvider: normalizeText(record?.llmProvider) || DEFAULT_IMPORT_AI_CONFIG.llmProvider,
    llmModel: normalizeText(record?.llmModel) || DEFAULT_IMPORT_AI_CONFIG.llmModel,
    promptVersion: normalizeText(record?.promptVersion) || DEFAULT_IMPORT_AI_CONFIG.promptVersion,
    promptLabel: normalizeText(record?.promptLabel) || DEFAULT_IMPORT_AI_CONFIG.promptLabel,
    outputContractVersion:
      normalizeText(record?.outputContractVersion) || DEFAULT_IMPORT_AI_CONFIG.outputContractVersion,
    notesJson: coerceRecord(record?.notesJson),
  };
}

async function getActiveImportAiConfigSnapshot(): Promise<ImportAiConfigSnapshot> {
  const active = await prismaAny.importAiConfig.findFirst({
    where: { isActive: true },
    orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
    select: {
      id: true,
      ocrProvider: true,
      ocrModel: true,
      llmProvider: true,
      llmModel: true,
      promptVersion: true,
      promptLabel: true,
      outputContractVersion: true,
      notesJson: true,
    },
  });
  return normalizeImportAiConfigSnapshot(active);
}

function normalizeExtractionMode(value: unknown): 'PRODUCTION' | 'BENCHMARK' {
  return normalizeText(value).toUpperCase() === 'BENCHMARK' ? 'BENCHMARK' : 'PRODUCTION';
}

function normalizeBenchmarkPhase(value: unknown): 'PHASE1' | 'PHASE2' | 'PHASE3' | null {
  const normalized = normalizeText(value).toUpperCase();
  if (normalized === 'PHASE1' || normalized === 'PHASE2' || normalized === 'PHASE3') return normalized;
  return null;
}

function normalizeStrictness(value: unknown): 'OFF' | 'BALANCED' | 'STRICT' | null {
  const normalized = normalizeText(value).toUpperCase();
  if (normalized === 'STRICT') return 'STRICT';
  if (normalized === 'BALANCED') return 'BALANCED';
  if (normalized === 'OFF') return 'OFF';
  return null;
}

function normalizeTemperature(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return null;
  return Math.max(0, Math.min(2, parsed));
}

function countHallucinatedServices(rawText: string, rows: Array<Record<string, unknown>>): number {
  const rawKey = normalizeNameKey(rawText);
  if (!rawKey) return 0;
  const expected = [
    ['kalici oje', ['kalici oje', 'kal oje', 'kal je', 'kalicioje']],
    ['tum vucut lazer', ['tum vucut lazer', 'tv', 'tum v', 'tv lazer']],
    ['kas alimi', ['kas', 'kas-', 'kash', 'kas alimi']],
    ['lazer', ['lazer', 'lezer', 'lover', 'lace']],
    ['agda', ['agda', 'hagda']],
    ['pedikur', ['pedikur']],
    ['manikur', ['manikur']],
    ['jel guclendirme', ['jel guclendirme']],
  ] as const;
  let penalty = 0;
  for (const row of rows) {
    const servicesRaw = normalizeNameKey(String(row.servicesNormalized || row.serviceNameRaw || ''));
    if (!servicesRaw) continue;
    for (const [canonical, aliases] of expected) {
      if (!servicesRaw.includes(canonical)) continue;
      const seen = aliases.some((alias) => rawKey.includes(alias));
      if (!seen) penalty += 1;
    }
  }
  return penalty;
}

function normalizeTextKey(value: unknown): string {
  return normalizeText(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeDateLoose(value: unknown): string | null {
  const text = normalizeText(value);
  if (!text) return null;
  const dmy = text.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{2,4})$/);
  if (dmy) {
    const dd = Number(dmy[1]);
    const mm = Number(dmy[2]);
    let yyyy = Number(dmy[3]);
    if (yyyy < 100) yyyy += 2000;
    if (dd < 1 || dd > 31 || mm < 1 || mm > 12) return null;
    return `${String(dd).padStart(2, '0')}.${String(mm).padStart(2, '0')}.${String(yyyy).padStart(4, '0')}`;
  }
  const iso = text.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (iso) return `${iso[3]}.${iso[2]}.${iso[1]}`;
  return null;
}

function normalizeTimeLoose(value: unknown): string | null {
  const text = normalizeText(value);
  if (!text) return null;
  const hhmm = text.match(/^(\d{1,2})[:.](\d{2})$/);
  if (hhmm) {
    const h = Number(hhmm[1]);
    const m = Number(hhmm[2]);
    if (h >= 0 && h <= 23 && m >= 0 && m <= 59) return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
  }
  const compact = text.match(/^(\d{2})(\d{2})$/);
  if (compact) {
    const h = Number(compact[1]);
    const m = Number(compact[2]);
    if (h >= 0 && h <= 23 && m >= 0 && m <= 59) return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
  }
  return null;
}

function tokenizeServices(value: unknown): string[] {
  const key = normalizeTextKey(value);
  if (!key) return [];
  const found = new Set<string>();
  if (/(tum vucut lazer|tv lazer|tv|t v)/.test(key)) found.add('tum vucut lazer');
  if (/(kas alimi|kas|kos)/.test(key)) found.add('kas alimi');
  if (/(kalici oje|kal oje|kal je)/.test(key)) found.add('kalici oje');
  if (/jel guclendirme/.test(key)) found.add('jel guclendirme');
  if (/pedikur/.test(key)) found.add('pedikur');
  if (/manikur/.test(key)) found.add('manikur');
  if (/agda/.test(key)) found.add('agda');
  return Array.from(found);
}

function tokenizeNotes(value: unknown): string[] {
  const key = normalizeTextKey(value);
  if (!key) return [];
  const out = new Set<string>();
  if (/hatirlat/.test(key)) out.add('hatirlat');
  if (/geldi/.test(key)) out.add('geldi');
  if (/iptal/.test(key)) out.add('iptal');
  if (/(odedi|odeme|odendi)/.test(key)) out.add('odedi');
  if (/aransin/.test(key)) out.add('aransin');
  return Array.from(out);
}

function foldTurkishText(value: string): string {
  const map: Record<string, string> = {
    ç: 'c',
    ğ: 'g',
    ı: 'i',
    İ: 'i',
    ö: 'o',
    ş: 's',
    ü: 'u',
    Ç: 'c',
    Ğ: 'g',
    Ö: 'o',
    Ş: 's',
    Ü: 'u',
  };
  return value
    .split('')
    .map((char) => map[char] || char)
    .join('')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function levenshteinDistance(inputA: string, inputB: string): number {
  const a = inputA;
  const b = inputB;
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  const dp = Array.from({ length: b.length + 1 }, (_, idx) => idx);
  for (let i = 1; i <= a.length; i += 1) {
    let prev = dp[0];
    dp[0] = i;
    for (let j = 1; j <= b.length; j += 1) {
      const tmp = dp[j]!;
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      dp[j] = Math.min(dp[j]! + 1, dp[j - 1]! + 1, prev + cost);
      prev = tmp;
    }
  }
  return dp[b.length]!;
}

function splitServiceRawTokens(value: string | null): string[] {
  const text = normalizeText(value);
  if (!text) return [];
  return text
    .split(/[,+/|-]/g)
    .map((token) => token.trim())
    .filter(Boolean);
}

function buildRowKey(date: string | null, time: string | null, ordinalByTime: number): string {
  return `${date || '-'}|${time || '-'}|${ordinalByTime}`;
}

function rowsFromStructuredOutput(rows: Array<Record<string, unknown>>): NormalizedEvalRow[] {
  const timeCounters = new Map<string, number>();
  const out: NormalizedEvalRow[] = [];
  for (const row of rows) {
    const appointmentDate = normalizeDateLoose(row.appointmentDate ?? row.date ?? null);
    const startTime = normalizeTimeLoose(row.startTime ?? row.time ?? row.hour ?? null);
    const counterKey = startTime || '-';
    const ordinal = (timeCounters.get(counterKey) || 0) + 1;
    timeCounters.set(counterKey, ordinal);
    out.push({
      rowKey: buildRowKey(appointmentDate, startTime, ordinal),
      appointmentDate,
      startTime,
      customerNameKey: normalizeTextKey(row.customerName ?? row.name ?? row.customer ?? null) || null,
      customerNameRaw: normalizeText(row.customerName ?? row.name ?? row.customer ?? null) || null,
      services: tokenizeServices(row.serviceNameRaw ?? row.servicesNormalized ?? row.service ?? null),
      serviceNameRaw: normalizeText(row.serviceNameRaw ?? row.servicesNormalized ?? row.service ?? null) || null,
      noteTokens: tokenizeNotes(row.notesRaw ?? row.note ?? row.notes ?? null),
    });
  }
  return out;
}

function splitByTimeSegments(rawLine: string): Array<{ time: string | null; rest: string }> {
  const line = rawLine.trim();
  if (!line) return [];
  const normalized = line.replace(/(\d{2})\.(\d{2})(?=\s|$)/g, '$1:$2');
  const matches = [...normalized.matchAll(/(?:^|\s)(\d{1,2}:\d{2}|\d{4})(?=\s|$)/g)];
  if (matches.length === 0) return [{ time: null, rest: normalized.trim() }];
  const out: Array<{ time: string | null; rest: string }> = [];
  for (let i = 0; i < matches.length; i += 1) {
    const m = matches[i]!;
    const token = m[1] || '';
    const start = m.index ?? 0;
    const tokenStart = start + m[0].length - token.length;
    const end = i + 1 < matches.length ? (matches[i + 1]!.index ?? normalized.length) : normalized.length;
    const rest = normalized.slice(tokenStart + token.length, end).trim();
    out.push({ time: normalizeTimeLoose(token), rest });
  }
  return out;
}

function extractDateFromLine(rawLine: string): { date: string | null; rest: string } {
  const line = rawLine.trim();
  if (!line) return { date: null, rest: '' };
  const match = line.match(/(\d{1,2}[./-]\d{1,2}[./-]\d{2,4}|\d{4}-\d{2}-\d{2})/);
  if (!match) return { date: null, rest: line };
  const date = normalizeDateLoose(match[1]);
  const rest = line.replace(match[1], ' ').replace(/\s+/g, ' ').trim();
  return { date, rest };
}

function rowsFromReferenceLikeText(rawText: string): NormalizedEvalRow[] {
  const text = rawText.replace(/\/n/gi, '\n');
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const out: NormalizedEvalRow[] = [];
  let activeDate: string | null = null;
  const timeCounters = new Map<string, number>();
  for (const line of lines) {
    const { date: extractedDate, rest } = extractDateFromLine(line);
    const dateInLine = extractedDate || normalizeDateLoose(line);
    if (dateInLine) {
      activeDate = dateInLine;
      if (!rest) continue;
    }
    const parsingLine = rest || line;
    const segments = splitByTimeSegments(parsingLine);
    for (const segment of segments) {
      if (!segment.time) continue;
      const ordinal = (timeCounters.get(segment.time) || 0) + 1;
      timeCounters.set(segment.time, ordinal);
      const customerName = segment.rest
        .replace(/\(?\+?\d[\d\s\-()]{8,}\)?/g, ' ')
        .replace(/(tum vucut lazer|tv lazer|tv|kas|kos|kalici oje|kal je|pedikur|manikur|agda|jel guclendirme)/gi, ' ')
        .replace(/(hatirlat|geldi|iptal|odedi|aransin)/gi, ' ')
        .replace(/[+\-]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
      out.push({
        rowKey: buildRowKey(activeDate, segment.time, ordinal),
        appointmentDate: activeDate,
        startTime: segment.time,
        customerNameKey: normalizeTextKey(customerName) || null,
        customerNameRaw: customerName || null,
        services: tokenizeServices(segment.rest),
        serviceNameRaw: segment.rest || null,
        noteTokens: tokenizeNotes(segment.rest),
      });
    }
  }
  return out;
}

function compareRows(
  referenceRows: NormalizedEvalRow[],
  targetRows: NormalizedEvalRow[],
): { totalFieldChecks: number; errorCount: number; rowCoverage: number } {
  const targetMap = new Map<string, NormalizedEvalRow>();
  for (const row of targetRows) targetMap.set(row.rowKey, row);

  let totalFieldChecks = 0;
  let errorCount = 0;
  let rowMatched = 0;

  for (const ref of referenceRows) {
    const got = targetMap.get(ref.rowKey);
    if (got) rowMatched += 1;
    if (ref.customerNameKey) {
      totalFieldChecks += 1;
      if (!got?.customerNameKey || got.customerNameKey !== ref.customerNameKey) errorCount += 1;
    }
    if (ref.services.length > 0) {
      totalFieldChecks += 1;
      const gotSet = new Set(got?.services || []);
      if (!ref.services.every((service) => gotSet.has(service))) errorCount += 1;
    }
    if (ref.noteTokens.length > 0) {
      totalFieldChecks += 1;
      const gotSet = new Set(got?.noteTokens || []);
      if (!ref.noteTokens.every((token) => gotSet.has(token))) errorCount += 1;
    }
  }
  return {
    totalFieldChecks,
    errorCount,
    rowCoverage: referenceRows.length > 0 ? rowMatched / referenceRows.length : 0,
  };
}

function extractBenchmarkReferenceText(auditRecord: Record<string, unknown>): string {
  const direct = normalizeText(auditRecord.benchmarkReferenceText);
  if (direct) return direct;
  const metrics = coerceRecord(auditRecord.metrics);
  const metricsText = normalizeText(metrics?.benchmarkReferenceText || metrics?.referenceText);
  if (metricsText) return metricsText;
  const activeConfig = coerceRecord(auditRecord.activeConfigSnapshot);
  const activeText = normalizeText(activeConfig?.benchmarkReferenceText);
  if (activeText) return activeText;
  const notesJson = coerceRecord(activeConfig?.notesJson);
  return normalizeText(notesJson?.benchmarkReferenceText || notesJson?.referenceText);
}

function pickBenchmarkReferenceText(input: {
  explicitBenchmarkReferenceText?: unknown;
  explicitReferenceText?: unknown;
  auditRecord: Record<string, unknown>;
}): string {
  const explicitBenchmark = normalizeText(input.explicitBenchmarkReferenceText);
  if (explicitBenchmark) return explicitBenchmark;
  const explicitLegacy = normalizeText(input.explicitReferenceText);
  if (explicitLegacy) return explicitLegacy;
  return extractBenchmarkReferenceText(input.auditRecord);
}

function scoreExtractionCandidate(input: {
  rawOutputText: string;
  parsedRows: Array<Record<string, unknown>>;
  ocrRawText: string;
  benchmarkReferenceText?: string;
}): { total: number; breakdown: Record<string, unknown> } {
  const outputText = normalizeText(input.rawOutputText);
  const rows = Array.isArray(input.parsedRows) ? input.parsedRows : [];
  const referenceText = normalizeText(input.benchmarkReferenceText);
  const referenceRows = rowsFromReferenceLikeText(referenceText || input.ocrRawText);
  const targetRows = rowsFromStructuredOutput(rows);

  const allowedSchemaKeys = new Set([
    'rowIndex',
    'customerName',
    'customerPhoneRaw',
    'appointmentDate',
    'startTime',
    'endTime',
    'durationMinutes',
    'serviceNameRaw',
    'staffNameRaw',
    'priceRaw',
    'notesRaw',
    'confidence',
  ]);
  const canonicalServiceLabels: Record<string, string> = {
    'tum vucut lazer': 'Tüm Vücut Lazer',
    'kas alimi': 'Kaş Alımı',
    'kalici oje': 'Kalıcı Oje',
    'jel guclendirme': 'Jel Güçlendirme',
    pedikur: 'Pedikür',
    manikur: 'Manikür',
    agda: 'Ağda',
  };
  const typoFindings: Array<{
    field: 'customerName' | 'serviceName';
    expected: string;
    actual: string;
    type: 'diacritic' | 'typo';
    severity: 'low' | 'high';
    distance: number;
    rowKey: string;
  }> = [];

  const keyToTargetIndexes = new Map<string, number[]>();
  targetRows.forEach((row, index) => {
    const arr = keyToTargetIndexes.get(row.rowKey) || [];
    arr.push(index);
    keyToTargetIndexes.set(row.rowKey, arr);
  });

  const usedTargetIndexes = new Set<number>();
  let matchedRows = 0;
  let missedRows = 0;
  let timeMismatchCount = 0;
  let nameMismatchCount = 0;
  let serviceMismatchCount = 0;
  let noteMismatchCount = 0;
  let hallucinatedServiceCount = 0;

  for (const ref of referenceRows) {
    let chosenIndex: number | null = null;
    const direct = keyToTargetIndexes.get(ref.rowKey) || [];
    for (const index of direct) {
      if (!usedTargetIndexes.has(index)) {
        chosenIndex = index;
        break;
      }
    }
    if (chosenIndex === null) {
      let bestScore = Number.NEGATIVE_INFINITY;
      for (let i = 0; i < targetRows.length; i += 1) {
        if (usedTargetIndexes.has(i)) continue;
        const row = targetRows[i]!;
        let score = 0;
        if (ref.startTime && row.startTime === ref.startTime) score += 4;
        else if (ref.startTime && row.startTime && row.startTime !== ref.startTime) score -= 2;
        if (ref.appointmentDate && row.appointmentDate === ref.appointmentDate) score += 2;
        if (ref.customerNameKey && row.customerNameKey === ref.customerNameKey) score += 3;
        if (ref.services.length > 0 && row.services.some((s) => ref.services.includes(s))) score += 2;
        if (score > bestScore) {
          bestScore = score;
          chosenIndex = i;
        }
      }
      if (bestScore < 2) chosenIndex = null;
    }

    if (chosenIndex === null) {
      missedRows += 1;
      continue;
    }

    usedTargetIndexes.add(chosenIndex);
    matchedRows += 1;
    const got = targetRows[chosenIndex]!;

    if (ref.startTime && got.startTime && ref.startTime !== got.startTime) timeMismatchCount += 1;
    if (ref.customerNameKey && (!got.customerNameKey || got.customerNameKey !== ref.customerNameKey)) {
      nameMismatchCount += 1;
      if (ref.customerNameRaw && got.customerNameRaw) {
        const expectedFold = foldTurkishText(ref.customerNameRaw);
        const actualFold = foldTurkishText(got.customerNameRaw);
        const distance = levenshteinDistance(expectedFold, actualFold);
        const isDiacriticOnly = expectedFold === actualFold && ref.customerNameRaw !== got.customerNameRaw;
        if (isDiacriticOnly || distance <= 2) {
          typoFindings.push({
            field: 'customerName',
            expected: ref.customerNameRaw,
            actual: got.customerNameRaw,
            type: isDiacriticOnly ? 'diacritic' : 'typo',
            severity: isDiacriticOnly ? 'low' : 'high',
            distance,
            rowKey: ref.rowKey,
          });
        }
      }
    }

    if (ref.services.length > 0) {
      const gotSet = new Set(got.services);
      const tokenMap = new Map<string, string>();
      const serviceTokens = splitServiceRawTokens(got.serviceNameRaw);
      for (const token of serviceTokens) {
        const canonicalList = tokenizeServices(token);
        for (const canonical of canonicalList) {
          if (!tokenMap.has(canonical)) tokenMap.set(canonical, token);
        }
      }
      for (const expectedService of ref.services) {
        if (!gotSet.has(expectedService)) serviceMismatchCount += 1;
        const expectedLabel = canonicalServiceLabels[expectedService] || expectedService;
        const actualToken = tokenMap.get(expectedService);
        if (actualToken) {
          const expectedFold = foldTurkishText(expectedLabel);
          const actualFold = foldTurkishText(actualToken);
          const distance = levenshteinDistance(expectedFold, actualFold);
          const isDiacriticOnly = expectedFold === actualFold && expectedLabel !== actualToken;
          if (isDiacriticOnly || distance <= 2) {
            typoFindings.push({
              field: 'serviceName',
              expected: expectedLabel,
              actual: actualToken,
              type: isDiacriticOnly ? 'diacritic' : 'typo',
              severity: isDiacriticOnly ? 'low' : 'high',
              distance,
              rowKey: ref.rowKey,
            });
          }
        }
      }
      for (const service of got.services) {
        if (!ref.services.includes(service)) hallucinatedServiceCount += 1;
      }
    }

    if (ref.noteTokens.length > 0) {
      const gotSet = new Set(got.noteTokens);
      for (const token of ref.noteTokens) {
        if (!gotSet.has(token)) noteMismatchCount += 1;
      }
    }
  }

  const hallucinatedRowCount = Math.max(0, targetRows.length - usedTargetIndexes.size);
  const fallbackHallucinatedServices = countHallucinatedServices(input.ocrRawText, rows);
  const hallucinationCount = hallucinatedRowCount + Math.max(hallucinatedServiceCount, fallbackHallucinatedServices);

  let schemaViolationCount = 0;
  let malformedTimes = 0;
  let invalidDates = 0;
  let phoneLeakCount = 0;
  for (const row of rows) {
    if (row && typeof row === 'object' && !Array.isArray(row)) {
      const keys = Object.keys(row);
      const unknownKeyCount = keys.filter((key) => !allowedSchemaKeys.has(key)).length;
      schemaViolationCount += unknownKeyCount;
    } else {
      schemaViolationCount += 1;
    }

    const valueTime = normalizeText((row as any)?.startTime ?? (row as any)?.time);
    if (valueTime && !normalizeTimeLoose(valueTime)) malformedTimes += 1;

    const valueDate = normalizeText((row as any)?.appointmentDate ?? (row as any)?.date);
    if (valueDate && !normalizeDateLoose(valueDate)) invalidDates += 1;

    const phoneRaw = normalizeDigitsOnly(normalizeText((row as any)?.customerPhoneRaw ?? (row as any)?.phoneRaw ?? (row as any)?.phone));
    if (phoneRaw) phoneLeakCount += 1;
  }
  schemaViolationCount += malformedTimes + invalidDates;

  const parseFailurePenalty = outputText ? 0 : 30;
  const missedRowsPenalty = missedRows * 12;
  const timePenalty = timeMismatchCount * 8;
  const namePenalty = nameMismatchCount * 6;
  const servicePenalty = serviceMismatchCount * 7;
  const notePenalty = noteMismatchCount * 3;
  const hallucinationPenalty = hallucinationCount * 20;
  const schemaPenalty = schemaViolationCount * 3;
  const phoneLeakPenalty = phoneLeakCount * 4;
  const typoPenalty = typoFindings.filter((finding) => finding.type === 'typo').length * 2;

  const errorScore =
    parseFailurePenalty +
    missedRowsPenalty +
    timePenalty +
    namePenalty +
    servicePenalty +
    notePenalty +
    hallucinationPenalty +
    schemaPenalty +
    phoneLeakPenalty +
    typoPenalty;

  return {
    total: Math.max(0, 1000 - errorScore),
    breakdown: {
      scoreVersion: 'v2',
      scoreTotal: Math.max(0, 1000 - errorScore),
      errorScore,
      hallucinationPenalty,
      schemaViolationCount,
      phoneLeakCount,
      matchedRows,
      missedRows,
      hallucinatedRowCount,
      hallucinatedServiceCount: Math.max(hallucinatedServiceCount, fallbackHallucinatedServices),
      malformedTimes,
      invalidDates,
      timeMismatchCount,
      nameMismatchCount,
      serviceMismatchCount,
      noteMismatchCount,
      typoCount: typoFindings.length,
      nameTypoCount: typoFindings.filter((finding) => finding.field === 'customerName').length,
      serviceTypoCount: typoFindings.filter((finding) => finding.field === 'serviceName').length,
      diacriticOnlyCount: typoFindings.filter((finding) => finding.type === 'diacritic').length,
      typoFindings: typoFindings.slice(0, 80),
      penalties: {
        parseFailurePenalty,
        missedRowsPenalty,
        timePenalty,
        namePenalty,
        servicePenalty,
        notePenalty,
        hallucinationPenalty,
        schemaPenalty,
        phoneLeakPenalty,
        typoPenalty,
      },
      referenceRowCount: referenceRows.length,
      targetRowCount: targetRows.length,
    },
  };
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

async function triggerImportWebhook(input: {
  batchId: string;
  sourceFileId: number;
  fileUrl: string | null;
  objectKey: string | null;
  sourceType: ImportSourceType;
  webhookUrl: string;
  mode: 'PRODUCTION' | 'BENCHMARK';
  benchmarkReferenceText?: string | null;
}) {
  if (!IMPORTS_OCR_AUTO_TRIGGER) {
    return { triggered: false, reason: 'ocr_auto_trigger_disabled' as const };
  }
  if (!input.webhookUrl) {
    return { triggered: false, reason: 'ocr_webhook_url_missing' as const };
  }
  if (!input.fileUrl) {
    return { triggered: false, reason: 'file_url_missing' as const };
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), IMPORTS_OCR_WEBHOOK_TIMEOUT_MS);
  try {
    const activeConfigSnapshot = await getActiveImportAiConfigSnapshot();
    const notesJson = asObject(activeConfigSnapshot.notesJson);
    const defaultReferenceText =
      normalizeText(notesJson.benchmarkReferenceText) || normalizeText(notesJson.referenceText) || null;
    const effectiveReferenceText =
      input.mode === 'BENCHMARK' ? normalizeText(input.benchmarkReferenceText) || defaultReferenceText : null;
    const enrichedConfig = {
      ...activeConfigSnapshot,
      notesJson: effectiveReferenceText ? { ...notesJson, benchmarkReferenceText: effectiveReferenceText } : notesJson,
      ...(effectiveReferenceText ? { benchmarkReferenceText: effectiveReferenceText } : {}),
    };
    const response = await fetch(input.webhookUrl, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(N8N_SHARED_INTERNAL_KEY ? { 'x-internal-api-key': N8N_SHARED_INTERNAL_KEY } : {}),
      },
      body: JSON.stringify({
        batchId: input.batchId,
        sourceFileId: input.sourceFileId,
        fileUrl: input.fileUrl,
        objectKey: input.objectKey,
        sourceType: input.sourceType,
        mode: input.mode,
        benchmarkReferenceText: effectiveReferenceText,
        aiConfig: enrichedConfig,
      }),
      signal: controller.signal,
    });
    if (!response.ok) {
      throw new Error(`ocr_webhook_http_${response.status}`);
    }
    return { triggered: true };
  } finally {
    clearTimeout(timeout);
  }
}

async function triggerImportOcrWebhook(input: {
  batchId: string;
  sourceFileId: number;
  fileUrl: string | null;
  objectKey: string | null;
  sourceType: ImportSourceType;
}) {
  return triggerImportWebhook({
    ...input,
    webhookUrl: IMPORTS_OCR_WEBHOOK_URL,
    mode: 'PRODUCTION',
  });
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

async function buildAutoMaps(salonId: number, _parsedRows: ParsedInputRow[]) {
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

  return { serviceMap, staffMap };
}

function normalizeRows(input: {
  batchId: string;
  parsedRows: ParsedInputRow[];
  serviceMap: Map<string, number>;
  staffMap: Map<string, number>;
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
    const appointmentDate = dateKey ? new Date(`${dateKey}T00:00:00.000Z`) : null;
    const warnings: string[] = [];

    const conflicts: NormalizedImportRow['conflicts'] = [];
    if (!customerPhoneNormalized) {
      warnings.push('CUSTOMER_PHONE_MISSING');
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
      warnings,
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
      matchedCustomerId: null,
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
    try {
      const webhookResult = await triggerImportOcrWebhook({
        batchId: input.batchId,
        sourceFileId: file.id,
        fileUrl: input.publicUrl || file.publicUrl,
        objectKey: input.objectKey || file.objectKey,
        sourceType: file.sourceType,
      });
      if (!webhookResult.triggered) {
        await prisma.importSourceFile.update({
          where: { id: file.id },
          data: {
            extractionError: String(webhookResult.reason),
          },
        });
      } else {
        await prisma.importSourceFile.update({
          where: { id: file.id },
          data: { extractionError: null },
        });
      }
    } catch (error: any) {
      const reason = error instanceof Error ? error.message.slice(0, 500) : 'ocr_webhook_trigger_failed';
      await prisma.importSourceFile.update({
        where: { id: file.id },
        data: {
          extractionError: reason,
        },
      });
    }

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

export async function triggerImportBenchmarkForFile(input: {
  salonId: number;
  batchId: string;
  sourceFileId: number;
  benchmarkReferenceText?: string | null;
}) {
  const file = await prisma.importSourceFile.findFirst({
    where: { id: input.sourceFileId, batchId: input.batchId, salonId: input.salonId },
    select: { id: true, sourceType: true, objectKey: true, publicUrl: true },
  });
  if (!file) throw new Error('source_file_not_found');
  if (!['PDF', 'IMAGE'].includes(file.sourceType)) {
    throw new Error('benchmark_requires_ocr_source');
  }

  const result = await triggerImportWebhook({
    batchId: input.batchId,
    sourceFileId: file.id,
    fileUrl: file.publicUrl,
    objectKey: file.objectKey,
    sourceType: file.sourceType,
    webhookUrl: IMPORTS_OCR_BENCHMARK_WEBHOOK_URL,
    mode: 'BENCHMARK',
    benchmarkReferenceText: normalizeText(input.benchmarkReferenceText) || null,
  });

  if (!result.triggered) {
    throw new Error(String(result.reason));
  }

  return { ok: true, queued: true };
}

export async function processImportOcrCallback(input: {
  batchId: string;
  sourceFileId: number;
  extractionError?: string | null;
  mode?: string | null;
  phase?: string | null;
  strictness?: string | null;
  temperature?: number | string | null;
  benchmarkReferenceText?: string | null;
  referenceText?: string | null;
  audit?: ImportExtractionAuditInput | null;
  candidates?: ImportExtractionCandidateInput[];
  rows?: Array<Record<string, unknown>>;
}) {
  const file = await prisma.importSourceFile.findFirst({
    where: { id: input.sourceFileId, batchId: input.batchId },
    select: { id: true, salonId: true, sourceType: true },
  });
  if (!file) throw new Error('source_file_not_found');

  const mode = normalizeExtractionMode(input.mode);
  const auditRecord = coerceRecord(input.audit) || {};
  const benchmarkPhase =
    normalizeBenchmarkPhase(input.phase) ||
    normalizeBenchmarkPhase(auditRecord.phase) ||
    normalizeBenchmarkPhase((coerceRecord(auditRecord.metrics) || {}).phase);
  const runStrictness =
    normalizeStrictness(input.strictness) ||
    normalizeStrictness(auditRecord.strictness) ||
    normalizeStrictness((coerceRecord(auditRecord.metrics) || {}).strictness);
  const runTemperature =
    normalizeTemperature(input.temperature) ??
    normalizeTemperature(auditRecord.temperature) ??
    normalizeTemperature((coerceRecord(auditRecord.metrics) || {}).temperature);
  const benchmarkReferenceText = pickBenchmarkReferenceText({
    explicitBenchmarkReferenceText: input.benchmarkReferenceText,
    explicitReferenceText: input.referenceText,
    auditRecord,
  });
  const activeConfigSnapshot = normalizeImportAiConfigSnapshot(auditRecord.activeConfigSnapshot);
  const ocrProvider = normalizeText(auditRecord.ocrProvider) || activeConfigSnapshot.ocrProvider;
  const ocrModel = normalizeText(auditRecord.ocrModel) || activeConfigSnapshot.ocrModel;
  const ocrRawText = normalizeText(auditRecord.ocrRawText);
  const metricsJson = coerceRecord(auditRecord.metrics);

  const extractionRun = await prismaAny.importExtractionRun.create({
    data: {
      batchId: input.batchId,
      sourceFileId: file.id,
      salonId: file.salonId,
      mode,
      status: 'RUNNING',
      ocrProvider,
      ocrModel,
      ocrRawText: ocrRawText || null,
      activeConfigSnapshot: activeConfigSnapshot as any,
      metricsJson: {
        ...(metricsJson || {}),
        phase: benchmarkPhase,
        strictness: runStrictness,
        temperature: runTemperature,
      } as any,
      error: null,
      startedAt: new Date(),
    },
    select: { id: true },
  });

  if (input.extractionError) {
    if (mode === 'PRODUCTION') {
      await prisma.importSourceFile.update({
        where: { id: file.id },
        data: { status: 'FAILED_EXTRACTION', extractionError: input.extractionError.slice(0, 800) },
      });
      await refreshBatchStatus(input.batchId);
    }
    await prismaAny.importExtractionRun.update({
      where: { id: extractionRun.id },
      data: {
        status: 'FAILED',
        error: input.extractionError.slice(0, 800),
        completedAt: new Date(),
      },
    });
    return { ok: false, parsedRowCount: 0, extractionRunId: extractionRun.id };
  }

  const callbackRows = Array.isArray(input.rows) ? input.rows : [];
  const candidateInputs = Array.isArray(input.candidates) ? input.candidates : [];
  const normalizedCandidates = candidateInputs.map((candidate) => {
    const parsedRows = Array.isArray(candidate.parsedRows)
      ? candidate.parsedRows.filter((row): row is Record<string, unknown> => Boolean(row && typeof row === 'object' && !Array.isArray(row)))
      : [];
    const scoring = scoreExtractionCandidate({
      rawOutputText: normalizeText(candidate.rawOutputText),
      parsedRows,
      ocrRawText,
      benchmarkReferenceText,
    });
    const breakdownRecord = coerceRecord(scoring.breakdown) || {};
    const candidatePhase = normalizeBenchmarkPhase(candidate.phase) || benchmarkPhase;
    const candidateStrictness = normalizeStrictness(candidate.strictness) || runStrictness;
    const candidateTemperature = normalizeTemperature(candidate.temperature) ?? runTemperature;
    return {
      provider: normalizeText(candidate.provider) || activeConfigSnapshot.llmProvider,
      model: normalizeText(candidate.model) || activeConfigSnapshot.llmModel,
      promptVersion: normalizeText(candidate.promptVersion) || activeConfigSnapshot.promptVersion,
      promptLabel: normalizeText(candidate.promptLabel) || activeConfigSnapshot.promptLabel,
      phase: candidatePhase,
      strictness: candidateStrictness,
      temperature: candidateTemperature,
      rawOutputText: normalizeText(candidate.rawOutputText) || null,
      parsedRows,
      scoreTotal: scoring.total,
      errorScore: Number.isFinite(Number(breakdownRecord.errorScore)) ? Number(breakdownRecord.errorScore) : 9999,
      hallucinationPenalty: Number.isFinite(Number(breakdownRecord.hallucinationPenalty))
        ? Number(breakdownRecord.hallucinationPenalty)
        : 9999,
      schemaViolationCount: Number.isFinite(Number(breakdownRecord.schemaViolationCount))
        ? Number(breakdownRecord.schemaViolationCount)
        : 9999,
      phoneLeakCount: Number.isFinite(Number(breakdownRecord.phoneLeakCount)) ? Number(breakdownRecord.phoneLeakCount) : 9999,
      scoreBreakdown: {
        ...scoring.breakdown,
        phase: candidatePhase,
        strictness: candidateStrictness,
        temperature: candidateTemperature,
      } as Record<string, unknown>,
      explicitSelected: candidate.isSelected === true,
    };
  });

  if (normalizedCandidates.length === 0 && callbackRows.length > 0) {
    const scoring = scoreExtractionCandidate({
      rawOutputText: normalizeText((auditRecord as Record<string, unknown>)?.rawOutputText),
      parsedRows: callbackRows,
      ocrRawText,
      benchmarkReferenceText,
    });
    normalizedCandidates.push({
      provider: activeConfigSnapshot.llmProvider,
      model: activeConfigSnapshot.llmModel,
      promptVersion: activeConfigSnapshot.promptVersion,
      promptLabel: activeConfigSnapshot.promptLabel,
      phase: benchmarkPhase,
      strictness: runStrictness,
      temperature: runTemperature,
      rawOutputText: normalizeText((auditRecord as Record<string, unknown>)?.rawOutputText) || null,
      parsedRows: callbackRows,
      scoreTotal: scoring.total,
      errorScore: Number.isFinite(Number((scoring.breakdown as Record<string, unknown>).errorScore))
        ? Number((scoring.breakdown as Record<string, unknown>).errorScore)
        : 9999,
      hallucinationPenalty: Number.isFinite(Number((scoring.breakdown as Record<string, unknown>).hallucinationPenalty))
        ? Number((scoring.breakdown as Record<string, unknown>).hallucinationPenalty)
        : 9999,
      schemaViolationCount: Number.isFinite(Number((scoring.breakdown as Record<string, unknown>).schemaViolationCount))
        ? Number((scoring.breakdown as Record<string, unknown>).schemaViolationCount)
        : 9999,
      phoneLeakCount: Number.isFinite(Number((scoring.breakdown as Record<string, unknown>).phoneLeakCount))
        ? Number((scoring.breakdown as Record<string, unknown>).phoneLeakCount)
        : 9999,
      scoreBreakdown: {
        ...scoring.breakdown,
        phase: benchmarkPhase,
        strictness: runStrictness,
        temperature: runTemperature,
      } as Record<string, unknown>,
      explicitSelected: mode === 'PRODUCTION',
    });
  }

  let selectedCandidateIndex = normalizedCandidates.findIndex((candidate) => candidate.explicitSelected);
  if (selectedCandidateIndex < 0 && normalizedCandidates.length > 0) {
    selectedCandidateIndex = normalizedCandidates
      .map((candidate, index) => ({
        index,
        hallucinationPenalty: candidate.hallucinationPenalty,
        errorScore: candidate.errorScore,
        schemaViolationCount: candidate.schemaViolationCount,
        phoneLeakCount: candidate.phoneLeakCount,
      }))
      .sort((a, b) => {
        if (a.hallucinationPenalty !== b.hallucinationPenalty) return a.hallucinationPenalty - b.hallucinationPenalty;
        if (a.errorScore !== b.errorScore) return a.errorScore - b.errorScore;
        if (a.schemaViolationCount !== b.schemaViolationCount) return a.schemaViolationCount - b.schemaViolationCount;
        if (a.phoneLeakCount !== b.phoneLeakCount) return a.phoneLeakCount - b.phoneLeakCount;
        return a.index - b.index;
      })[0]!.index;
  }

  let selectedCandidateId: number | null = null;
  for (let index = 0; index < normalizedCandidates.length; index += 1) {
    const candidate = normalizedCandidates[index];
    const created = await prismaAny.importExtractionCandidate.create({
      data: {
        extractionRunId: extractionRun.id,
        provider: candidate.provider,
        model: candidate.model,
        promptVersion: candidate.promptVersion,
        promptLabel: candidate.promptLabel || null,
        rawOutputText: candidate.rawOutputText,
        parsedRowsJson: candidate.parsedRows as any,
        scoreTotal: candidate.scoreTotal,
        scoreBreakdownJson: candidate.scoreBreakdown as any,
        isSelected: index === selectedCandidateIndex,
      },
      select: { id: true },
    });
    if (index === selectedCandidateIndex) {
      selectedCandidateId = created.id;
    }
  }

  const finalRows =
    mode === 'PRODUCTION'
      ? selectedCandidateIndex >= 0
        ? normalizedCandidates[selectedCandidateIndex]?.parsedRows || []
        : callbackRows
      : [];

  const parsedRows: ParsedInputRow[] = finalRows.map((raw, idx) => ({
    rowIndex: Number(raw?.rowIndex) > 0 ? Number(raw.rowIndex) : idx + 1,
    sourceType: file.sourceType,
    raw,
    confidence: Number.isFinite(Number(raw?.confidence)) ? Number(raw.confidence) : null,
  }));

  let parsedRowCount = 0;
  if (mode === 'PRODUCTION') {
    const maps = await buildAutoMaps(file.salonId, parsedRows);
    const normalized = normalizeRows({
      batchId: input.batchId,
      parsedRows,
      serviceMap: maps.serviceMap,
      staffMap: maps.staffMap,
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
    parsedRowCount = normalized.length;
  }

  await prismaAny.importExtractionRun.update({
    where: { id: extractionRun.id },
    data: {
      status: 'COMPLETED',
      selectedCandidateId,
      completedAt: new Date(),
      metricsJson: {
        ...(metricsJson || {}),
        phase: benchmarkPhase,
        strictness: runStrictness,
        temperature: runTemperature,
        callbackRowCount: callbackRows.length,
        parsedRowCount,
        candidateCount: normalizedCandidates.length,
      } as any,
    },
  });

  return {
    ok: true,
    parsedRowCount,
    extractionRunId: extractionRun.id,
    candidateCount: normalizedCandidates.length,
  };
}

export async function getImportBatchState(input: { salonId: number; batchId: string }) {
  const batch = await prismaAny.importBatch.findFirst({
    where: { id: input.batchId, salonId: input.salonId },
    include: {
      files: { orderBy: { id: 'asc' } },
      commitRuns: { orderBy: { id: 'desc' }, take: 5 },
      extractionRuns: { orderBy: { id: 'desc' }, take: 10 },
    },
  });
  if (!batch) throw new Error('batch_not_found');
  return batch;
}

export async function getImportPreview(input: { salonId: number; batchId: string; limitRows?: number }) {
  const take = Math.max(20, Math.min(500, Number(input.limitRows) || 200));
  const [batch, rows, conflicts, services, staff, extractionRuns] = await Promise.all([
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
    prismaAny.importExtractionRun.findMany({
      where: { batchId: input.batchId, salonId: input.salonId },
      orderBy: [{ id: 'desc' }],
      take: 20,
      include: {
        candidates: {
          orderBy: [{ scoreTotal: 'desc' }, { id: 'asc' }],
          take: 50,
        },
      },
    }),
  ]);
  if (!batch) throw new Error('batch_not_found');
  return { batch, rows, conflicts, mappingOptions: { services, staff }, extractionRuns };
}

export async function getImportAiConfig() {
  const [activeConfig, recentConfigs] = await Promise.all([
    prismaAny.importAiConfig.findFirst({
      where: { isActive: true },
      orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
    }),
    prismaAny.importAiConfig.findMany({
      orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
      take: 20,
    }),
  ]);
  return { activeConfig, recentConfigs };
}

export async function upsertImportAiConfig(input: {
  userId: number;
  ocrProvider: string;
  ocrModel?: string | null;
  llmProvider: string;
  llmModel: string;
  promptVersion: string;
  promptLabel?: string | null;
  outputContractVersion: string;
  notesJson?: Record<string, unknown> | null;
}) {
  return prisma.$transaction(async (tx) => {
        await (tx as any).importAiConfig.updateMany({
      where: { isActive: true },
      data: { isActive: false },
    });
        return (tx as any).importAiConfig.create({
      data: {
        ocrProvider: normalizeText(input.ocrProvider) || DEFAULT_IMPORT_AI_CONFIG.ocrProvider,
        ocrModel: normalizeText(input.ocrModel) || DEFAULT_IMPORT_AI_CONFIG.ocrModel,
        llmProvider: normalizeText(input.llmProvider) || DEFAULT_IMPORT_AI_CONFIG.llmProvider,
        llmModel: normalizeText(input.llmModel) || DEFAULT_IMPORT_AI_CONFIG.llmModel,
        promptVersion: normalizeText(input.promptVersion) || DEFAULT_IMPORT_AI_CONFIG.promptVersion,
        promptLabel: normalizeText(input.promptLabel) || null,
        outputContractVersion:
          normalizeText(input.outputContractVersion) || DEFAULT_IMPORT_AI_CONFIG.outputContractVersion,
        isActive: true,
        notesJson: (input.notesJson || null) as any,
        activatedByUserId: input.userId,
      },
    });
  });
}

export async function getImportBenchmarkRuns(input: { salonId: number; batchId: string; sourceFileId: number }) {
  const file = await prisma.importSourceFile.findFirst({
    where: { id: input.sourceFileId, batchId: input.batchId, salonId: input.salonId },
    select: { id: true },
  });
  if (!file) throw new Error('source_file_not_found');

  return prismaAny.importExtractionRun.findMany({
    where: {
      batchId: input.batchId,
      sourceFileId: input.sourceFileId,
      salonId: input.salonId,
      mode: 'BENCHMARK',
    },
    orderBy: [{ id: 'desc' }],
    include: {
      candidates: {
        orderBy: [{ scoreTotal: 'desc' }, { id: 'asc' }],
      },
    },
  });
}

export async function selectImportBenchmarkCandidate(input: {
  salonId: number;
  userId: number;
  candidateId: number;
  activateConfig?: boolean;
}) {
  const candidate = await prismaAny.importExtractionCandidate.findFirst({
    where: {
      id: input.candidateId,
      extractionRun: {
        salonId: input.salonId,
      },
    },
    include: {
      extractionRun: true,
    },
  });
  if (!candidate) throw new Error('candidate_not_found');

  await prisma.$transaction(async (tx) => {
    await (tx as any).importExtractionCandidate.updateMany({
      where: { extractionRunId: candidate.extractionRunId },
      data: { isSelected: false },
    });
    await (tx as any).importExtractionCandidate.update({
      where: { id: candidate.id },
      data: {
        isSelected: true,
        reviewedByUserId: input.userId,
        reviewedAt: new Date(),
      },
    });
    await (tx as any).importExtractionRun.update({
      where: { id: candidate.extractionRunId },
      data: {
        selectedCandidateId: candidate.id,
        completedAt: candidate.extractionRun.completedAt || new Date(),
      },
    });

    if (input.activateConfig !== false) {
      const snapshot = normalizeImportAiConfigSnapshot(candidate.extractionRun.activeConfigSnapshot);
      await (tx as any).importAiConfig.updateMany({
        where: { isActive: true },
        data: { isActive: false },
      });
      await (tx as any).importAiConfig.create({
        data: {
          ocrProvider: snapshot.ocrProvider,
          ocrModel: snapshot.ocrModel,
          llmProvider: candidate.provider,
          llmModel: candidate.model,
          promptVersion: candidate.promptVersion,
          promptLabel: candidate.promptLabel,
          outputContractVersion: snapshot.outputContractVersion,
          isActive: true,
          notesJson: {
            benchmarkCandidateId: candidate.id,
            benchmarkExtractionRunId: candidate.extractionRunId,
          } as any,
          activatedByUserId: input.userId,
        },
      });
    }
  });

  return {
    ok: true,
    candidateId: candidate.id,
    extractionRunId: candidate.extractionRunId,
    activatedConfig: input.activateConfig !== false,
  };
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
    select: { id: true, matchedServiceId: true, matchedStaffId: true },
  });

  for (const row of rows) {
    const openConflicts = await prisma.importConflict.count({
      where: { batchId: input.batchId, rowId: row.id, status: 'OPEN' },
    });
    const isReady =
      openConflicts === 0 &&
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
}) {
  if (row.matchedServiceId) return row.matchedServiceId;
  if (!row.serviceNameRaw) return null;

  const existing = await prisma.service.findFirst({
    where: { salonId, name: { equals: row.serviceNameRaw, mode: 'insensitive' } },
    select: { id: true },
  });
  return existing?.id || null;
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
  return existing?.id || null;
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
      where: { batchId: input.batchId, salonId: input.salonId, rowStatus: 'READY' },
      orderBy: [{ id: 'asc' }],
    });

    let imported = 0;
    let conflicts = 0;
    let failed = 0;
    let skipped = 0;

    for (const row of rows) {
      try {
        const serviceId = await ensureServiceForRow(input.salonId, row);
        const staffId = await ensureStaffForRow(input.salonId, row);

        if (!serviceId || !staffId) {
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
              message: 'Row requires mapped service and staff.',
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

        const appointment = await prisma.appointment.create({
          data: {
            salonId: input.salonId,
            customerId: null,
            customerName: row.customerName || 'Misafir',
            customerPhone: row.customerPhoneNormalized || '',
            serviceId,
            staffId,
            startTime,
            endTime,
            status: startTime.getTime() < Date.now() ? 'COMPLETED' : 'BOOKED',
            source: 'IMPORT' as any,
            notes: null,
            gender: 'female',
            listPrice: service.price,
            finalPrice: Number.isFinite(row.priceRaw || NaN) ? Number(row.priceRaw) : service.price,
          },
          select: { id: true },
        });

        await prisma.importRow.update({
          where: { id: row.id },
          data: {
            rowStatus: 'IMPORTED',
            matchedCustomerId: null,
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
