import { prisma } from '../prisma.js';
import { buildAppointmentReschedulePreview, type ReschedulePreviewResult } from './appointmentReschedule.js';

export type RescheduleOptionItem = {
  time: string;
  startTime: string;
  endTime: string;
  requiresManualSelection: boolean;
  preview: ReschedulePreviewResult;
};

export type RescheduleOptionsResponse = {
  date: string;
  slots: RescheduleOptionItem[];
};

const SLOT_INCREMENT_MINUTES = 5;
const DISPLAY_CLUSTER_MINUTES = 15;

function toIsoDate(value: Date): string {
  return value.toISOString().split('T')[0];
}

function createDateTime(date: string, minutesFromMidnight: number): Date {
  const value = new Date(`${date}T00:00:00`);
  value.setMinutes(minutesFromMidnight, 0, 0);
  return value;
}

function formatTime(value: Date): string {
  const hours = String(value.getHours()).padStart(2, '0');
  const minutes = String(value.getMinutes()).padStart(2, '0');
  return `${hours}:${minutes}`;
}

function clusterOptions(options: RescheduleOptionItem[]): RescheduleOptionItem[] {
  const result: RescheduleOptionItem[] = [];
  let lastAcceptedMinutes: number | null = null;

  for (const option of options) {
    const currentMinutes = Number(option.time.slice(0, 2)) * 60 + Number(option.time.slice(3, 5));
    if (lastAcceptedMinutes !== null && currentMinutes <= lastAcceptedMinutes + DISPLAY_CLUSTER_MINUTES) {
      continue;
    }
    result.push(option);
    lastAcceptedMinutes = currentMinutes;
  }

  return result;
}

export async function buildRescheduleOptions(input: {
  salonId: number;
  appointmentIds: number[];
  date: string;
  assignments?: Record<number, number>;
}): Promise<RescheduleOptionsResponse> {
  const targetDate = toIsoDate(new Date(`${input.date}T00:00:00`));
  const settings = await prisma.salonSettings.findUnique({
    where: { salonId: input.salonId },
    select: { workStartHour: true, workEndHour: true },
  });

  const startHour = settings?.workStartHour ?? 9;
  const endHour = settings?.workEndHour ?? 18;
  const options: RescheduleOptionItem[] = [];

  for (let minutes = startHour * 60; minutes < endHour * 60; minutes += SLOT_INCREMENT_MINUTES) {
    const newStartTime = createDateTime(targetDate, minutes);
    const preview = await buildAppointmentReschedulePreview({
      salonId: input.salonId,
      appointmentIds: input.appointmentIds,
      newStartTime,
      assignments: input.assignments,
    });

    if (preview.hasConflicts || !preview.items.length) {
      continue;
    }

    const endTime = preview.items.reduce((latest, item) => {
      const candidate = new Date(item.newEndTime).getTime();
      return candidate > latest ? candidate : latest;
    }, newStartTime.getTime());

    options.push({
      time: formatTime(newStartTime),
      startTime: newStartTime.toISOString(),
      endTime: new Date(endTime).toISOString(),
      requiresManualSelection: preview.requiresManualSelection,
      preview,
    });
  }

  return {
    date: targetDate,
    slots: clusterOptions(options),
  };
}
