const types = require('./types');

const LegacyAppointmentRecord = types.LegacyAppointmentRecord;
const LegacyLeaveRecord = types.LegacyLeaveRecord;
const LegacyLockRecord = types.LegacyLockRecord;

/**
 * Normalizes TEXT date/time fields from legacy database into proper Date objects
 */
class DateNormalizer {
  /**
   * Parse TEXT date string like "2024-01-15" into Date
   */
  static parseDate(dateStr: string): Date {
    const date = new Date(dateStr);
    if (isNaN(date.getTime())) {
      throw new Error(`Invalid date format: ${dateStr}`);
    }
    return date;
  }

  /**
   * Parse TEXT time string like "10:00" into minutes since midnight
   */
  static parseTimeToMinutes(timeStr: string): number {
    const [hours, minutes] = timeStr.split(':').map(Number);
    if (isNaN(hours) || isNaN(minutes) || hours < 0 || hours > 23 || minutes < 0 || minutes > 59) {
      throw new Error(`Invalid time format: ${timeStr}`);
    }
    return hours * 60 + minutes;
  }

  /**
   * Parse TEXT datetime string into Date
   */
  static parseDateTime(dateTimeStr: string): Date {
    const date = new Date(dateTimeStr);
    if (isNaN(date.getTime())) {
      throw new Error(`Invalid datetime format: ${dateTimeStr}`);
    }
    return date;
  }

  /**
   * Create Date from date string and time minutes
   */
  static createDateTime(dateStr: string, timeMinutes: number): Date {
    const date = this.parseDate(dateStr);
    const hours = Math.floor(timeMinutes / 60);
    const minutes = timeMinutes % 60;
    date.setHours(hours, minutes, 0, 0);
    return date;
  }

  /**
   * Parse duration string like "60" into minutes
   */
  static parseDuration(durationStr: string): number {
    const duration = parseInt(durationStr, 10);
    if (isNaN(duration) || duration <= 0) {
      throw new Error(`Invalid duration: ${durationStr}`);
    }
    return duration;
  }
}

/**
 * Normalizes legacy appointment records
 */
class AppointmentNormalizer {
  static normalize(record: any) {
    const startTimeMinutes = DateNormalizer.parseTimeToMinutes(record.saat);
    const duration = DateNormalizer.parseDuration(record.sure);

    return {
      id: parseInt(record.id),
      staffId: parseInt(record.calisan_id),
      date: DateNormalizer.parseDate(record.tarih),
      startTime: DateNormalizer.createDateTime(record.tarih, startTimeMinutes),
      endTime: DateNormalizer.createDateTime(record.tarih, startTimeMinutes + duration),
      duration,
      status: record.durum
    };
  }
}

/**
 * Normalizes legacy leave records
 */
class LeaveNormalizer {
  static normalize(record: any) {
    return {
      id: parseInt(record.id),
      staffId: parseInt(record.calisan_id),
      startDate: DateNormalizer.parseDate(record.baslangic_tarihi),
      endDate: DateNormalizer.parseDate(record.bitis_tarihi),
      reason: record.neden
    };
  }
}

/**
 * Normalizes legacy lock records
 */
class LockNormalizer {
  static normalize(record: any) {
    const startTimeMinutes = DateNormalizer.parseTimeToMinutes(record.saat);
    const duration = DateNormalizer.parseDuration(record.sure);

    return {
      id: record.id,
      salonId: parseInt(record.salon_id),
      date: DateNormalizer.parseDate(record.tarih),
      startTime: DateNormalizer.createDateTime(record.tarih, startTimeMinutes),
      endTime: DateNormalizer.createDateTime(record.tarih, startTimeMinutes + duration),
      expiresAt: DateNormalizer.parseDateTime(record.expires_at),
      createdAt: DateNormalizer.parseDateTime(record.created_at)
    };
  }
}

module.exports = {
  DateNormalizer,
  AppointmentNormalizer,
  LeaveNormalizer,
  LockNormalizer
};
