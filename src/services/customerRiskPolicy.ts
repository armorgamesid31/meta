import { prisma } from '../prisma.js';

export const CUSTOMER_RISK_POLICY_AUTOMATION_KEY = 'customer_risk_policy';

export type ValidityWindow = '1m' | '3m' | '6m' | '1y' | 'unlimited';
export type AttendanceRangeKey = '0_3' | '4_5' | '6_7' | '8_9' | '10_plus';
export type AttendancePenaltyAction =
  | 'normal'
  | 'simple_warning'
  | 'possible_block'
  | 'manual_approval'
  | 'full_block';

export type AttendanceNotificationConfig = {
  missedAppointments: boolean;
  lateCancellations: boolean;
  lateReschedules: boolean;
};

export type AttendanceConfig = {
  countMissedAppointments: boolean;
  countLateCancellations: boolean;
  countLateReschedules: boolean;
  lateCancellationHours: number;
  lateRescheduleHours: number;
  validityWindow: ValidityWindow;
  notificationEvents: AttendanceNotificationConfig;
  penaltyPolicy: Record<AttendanceRangeKey, AttendancePenaltyAction>;
};

export type CustomerRiskPolicy = {
  autoBanEnabled: boolean;
  noShowThreshold: number;
  blockBookingWhenBanned: boolean;
  attendanceConfig: AttendanceConfig;
};

const VALIDITY_WINDOWS: ValidityWindow[] = ['1m', '3m', '6m', '1y', 'unlimited'];
const ATTENDANCE_RANGE_KEYS: AttendanceRangeKey[] = ['0_3', '4_5', '6_7', '8_9', '10_plus'];
const ATTENDANCE_ACTIONS: AttendancePenaltyAction[] = [
  'normal',
  'simple_warning',
  'possible_block',
  'manual_approval',
  'full_block',
];

export const DEFAULT_ATTENDANCE_CONFIG: AttendanceConfig = {
  countMissedAppointments: true,
  countLateCancellations: true,
  countLateReschedules: true,
  lateCancellationHours: 24,
  lateRescheduleHours: 12,
  validityWindow: '6m',
  notificationEvents: {
    missedAppointments: true,
    lateCancellations: true,
    lateReschedules: true,
  },
  penaltyPolicy: {
    '0_3': 'normal',
    '4_5': 'simple_warning',
    '6_7': 'possible_block',
    '8_9': 'manual_approval',
    '10_plus': 'full_block',
  },
};

export const DEFAULT_CUSTOMER_RISK_POLICY: CustomerRiskPolicy = {
  autoBanEnabled: false,
  noShowThreshold: 3,
  blockBookingWhenBanned: true,
  attendanceConfig: DEFAULT_ATTENDANCE_CONFIG,
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function toBoolean(value: unknown, fallback: boolean): boolean {
  if (typeof value === 'boolean') return value;
  return fallback;
}

function toPositiveInt(value: unknown, fallback: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  const rounded = Math.floor(parsed);
  if (rounded <= 0) return fallback;
  return rounded;
}

function toValidityWindow(value: unknown, fallback: ValidityWindow): ValidityWindow {
  if (typeof value !== 'string') return fallback;
  return VALIDITY_WINDOWS.includes(value as ValidityWindow) ? (value as ValidityWindow) : fallback;
}

function toAttendanceAction(value: unknown, fallback: AttendancePenaltyAction): AttendancePenaltyAction {
  if (typeof value !== 'string') return fallback;
  return ATTENDANCE_ACTIONS.includes(value as AttendancePenaltyAction)
    ? (value as AttendancePenaltyAction)
    : fallback;
}

function mergeAttendanceConfig(current: AttendanceConfig, patch: unknown): AttendanceConfig {
  const raw = isRecord(patch) ? patch : {};
  const notificationEventsRaw = isRecord(raw.notificationEvents) ? raw.notificationEvents : {};
  const penaltyPolicyRaw = isRecord(raw.penaltyPolicy) ? raw.penaltyPolicy : {};

  return {
    countMissedAppointments: toBoolean(raw.countMissedAppointments, current.countMissedAppointments),
    countLateCancellations: toBoolean(raw.countLateCancellations, current.countLateCancellations),
    countLateReschedules: toBoolean(raw.countLateReschedules, current.countLateReschedules),
    lateCancellationHours: toPositiveInt(raw.lateCancellationHours, current.lateCancellationHours),
    lateRescheduleHours: toPositiveInt(raw.lateRescheduleHours, current.lateRescheduleHours),
    validityWindow: toValidityWindow(raw.validityWindow, current.validityWindow),
    notificationEvents: {
      missedAppointments: toBoolean(
        notificationEventsRaw.missedAppointments,
        current.notificationEvents.missedAppointments,
      ),
      lateCancellations: toBoolean(
        notificationEventsRaw.lateCancellations,
        current.notificationEvents.lateCancellations,
      ),
      lateReschedules: toBoolean(
        notificationEventsRaw.lateReschedules,
        current.notificationEvents.lateReschedules,
      ),
    },
    penaltyPolicy: ATTENDANCE_RANGE_KEYS.reduce<Record<AttendanceRangeKey, AttendancePenaltyAction>>((acc, key) => {
      acc[key] = toAttendanceAction(penaltyPolicyRaw[key], current.penaltyPolicy[key]);
      return acc;
    }, {} as Record<AttendanceRangeKey, AttendancePenaltyAction>),
  };
}

function parseCustomerRiskPolicy(config: unknown): CustomerRiskPolicy {
  const raw = isRecord(config) ? config : {};
  return {
    autoBanEnabled: toBoolean(raw.autoBanEnabled, DEFAULT_CUSTOMER_RISK_POLICY.autoBanEnabled),
    noShowThreshold: toPositiveInt(raw.noShowThreshold, DEFAULT_CUSTOMER_RISK_POLICY.noShowThreshold),
    blockBookingWhenBanned: toBoolean(
      raw.blockBookingWhenBanned,
      DEFAULT_CUSTOMER_RISK_POLICY.blockBookingWhenBanned,
    ),
    attendanceConfig: mergeAttendanceConfig(DEFAULT_ATTENDANCE_CONFIG, raw.attendanceConfig),
  };
}

export async function getSalonCustomerRiskPolicy(salonId: number): Promise<CustomerRiskPolicy> {
  const rule = await prisma.automationRule.findUnique({
    where: {
      salonId_key: {
        salonId,
        key: CUSTOMER_RISK_POLICY_AUTOMATION_KEY,
      },
    },
    select: {
      config: true,
      isEnabled: true,
    },
  });

  const parsed = parseCustomerRiskPolicy(rule?.config);
  if (!rule) return parsed;

  if (rule.isEnabled === false) {
    return {
      ...parsed,
      autoBanEnabled: false,
    };
  }

  return parsed;
}

export async function upsertSalonCustomerRiskPolicy(
  salonId: number,
  input: Partial<CustomerRiskPolicy>,
): Promise<CustomerRiskPolicy> {
  const current = await getSalonCustomerRiskPolicy(salonId);
  const next: CustomerRiskPolicy = {
    autoBanEnabled: input.autoBanEnabled ?? current.autoBanEnabled,
    noShowThreshold: toPositiveInt(input.noShowThreshold, current.noShowThreshold),
    blockBookingWhenBanned: input.blockBookingWhenBanned ?? current.blockBookingWhenBanned,
    attendanceConfig: mergeAttendanceConfig(current.attendanceConfig, input.attendanceConfig),
  };

  await prisma.automationRule.upsert({
    where: {
      salonId_key: {
        salonId,
        key: CUSTOMER_RISK_POLICY_AUTOMATION_KEY,
      },
    },
    update: {
      isEnabled: true,
      config: next as any,
      name: 'Customer Risk Policy',
      description: 'No-show based auto ban and booking block policy.',
    },
    create: {
      salonId,
      key: CUSTOMER_RISK_POLICY_AUTOMATION_KEY,
      name: 'Customer Risk Policy',
      description: 'No-show based auto ban and booking block policy.',
      config: next as any,
      isEnabled: true,
    },
  });

  return next;
}
