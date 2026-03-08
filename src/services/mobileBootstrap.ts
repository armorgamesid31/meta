import type { SalonUser } from '@prisma/client';

const ROLE_CAPABILITIES: Record<string, Record<string, boolean>> = {
  OWNER: {
    manageSalon: true,
    manageStaff: true,
    manageServices: true,
    manageCustomers: true,
    manageAppointments: true,
    viewAnalytics: true,
    viewFinance: true,
    manageMarketing: true,
    manageFeatureFlags: true,
  },
  MANAGER: {
    manageSalon: true,
    manageStaff: true,
    manageServices: true,
    manageCustomers: true,
    manageAppointments: true,
    viewAnalytics: true,
    viewFinance: false,
    manageMarketing: true,
    manageFeatureFlags: false,
  },
  RECEPTION: {
    manageSalon: false,
    manageStaff: false,
    manageServices: false,
    manageCustomers: true,
    manageAppointments: true,
    viewAnalytics: false,
    viewFinance: false,
    manageMarketing: false,
    manageFeatureFlags: false,
  },
  STAFF: {
    manageSalon: false,
    manageStaff: false,
    manageServices: false,
    manageCustomers: true,
    manageAppointments: true,
    viewAnalytics: false,
    viewFinance: false,
    manageMarketing: false,
    manageFeatureFlags: false,
  },
  FINANCE: {
    manageSalon: false,
    manageStaff: false,
    manageServices: false,
    manageCustomers: false,
    manageAppointments: false,
    viewAnalytics: true,
    viewFinance: true,
    manageMarketing: false,
    manageFeatureFlags: false,
  },
};

function normalizeRole(role?: string | null): string {
  const normalized = (role || '').toUpperCase();
  if (ROLE_CAPABILITIES[normalized]) {
    return normalized;
  }
  return 'STAFF';
}

function toDisplayName(email: string): string {
  const localPart = email.split('@')[0] || 'User';
  return localPart
    .split(/[._-]+/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(' ');
}

export function buildCapabilities(role: string) {
  const normalized = normalizeRole(role);
  return {
    role: normalized,
    ...ROLE_CAPABILITIES[normalized],
  };
}

export function buildFeatureFlags(role: string, bookingMode?: string | null, hasWhatsapp?: boolean) {
  const normalized = normalizeRole(role);
  const canUseAdmin = ['OWNER', 'MANAGER', 'RECEPTION', 'STAFF', 'FINANCE'].includes(normalized);

  return {
    dashboard: true,
    appointments: canUseAdmin,
    customers: canUseAdmin,
    analytics: ['OWNER', 'MANAGER', 'FINANCE'].includes(normalized),
    websiteBuilder: false,
    campaigns: false,
    automations: false,
    whatsappAutomation: bookingMode === 'WHATSAPP' || Boolean(hasWhatsapp),
  };
}

export function buildSubscription() {
  return {
    plan: process.env.DEFAULT_SUBSCRIPTION_PLAN || 'starter',
    status: process.env.DEFAULT_SUBSCRIPTION_STATUS || 'trial',
  };
}

export function buildBootstrapUser(user: Pick<SalonUser, 'id' | 'email' | 'role'>) {
  const normalizedRole = normalizeRole(user.role);
  return {
    id: user.id,
    name: toDisplayName(user.email),
    role: normalizedRole,
  };
}
