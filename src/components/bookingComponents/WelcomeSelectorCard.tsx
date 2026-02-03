import React from 'react';
import { DateSelector } from './DateSelector';
import { TimeSlotGrid } from './TimeSlotGrid';
import { BookingInfoForm, FormData } from './BookingInfoForm';
import { PrimaryActionButton } from './PrimaryActionButton';
import { TimeSlot } from './types';

interface DateOption {
  id: string;
  date: Date;
  dayOfMonth: number;
  dayName: string;
  available: boolean;
}

export interface WelcomeSelectorCardProps {
  title?: string;
  subtitle?: string;
  dates: DateOption[];
  timeSlots: TimeSlot[];
  selectedDateId?: string;
  selectedTimeSlotId?: string;
  formData?: FormData;
  showNotificationBanner?: boolean;
  notificationMessage?: string;
  onSelectDate: (dateId: string) => void;
  onSelectTimeSlot: (slotId: string) => void;
  onFormChange?: (data: FormData) => void;
  onProceed?: () => void;
  proceedLabel?: string;
  bannerActionLabel?: string;
  onBannerAction?: () => void;
}

export const WelcomeSelectorCard: React.FC<WelcomeSelectorCardProps> = ({
  title = 'Randevu Al',
  subtitle,
  dates,
  timeSlots,
  selectedDateId,
  selectedTimeSlotId,
  formData,
  showNotificationBanner = true,
  notificationMessage = 'Bu Gün İçin Bekleme Listesine Girin\nBir yer açılırsa size WhatsApp\'tan haber verelim',
  onSelectDate,
  onSelectTimeSlot,
  onFormChange,
  onProceed,
  proceedLabel = 'Sıraya Gir',
  bannerActionLabel = 'Sıraya Gir',
  onBannerAction,
}) => {
  return (
    <div className="w-full max-w-2xl mx-auto space-y-6">
      {/* Header */}
      {title && (
        <div className="text-center">
          <h1 className="text-2xl font-bold text-gray-900">{title}</h1>
          {subtitle && <p className="text-gray-600 text-sm mt-2">{subtitle}</p>}
        </div>
      )}

      {/* Notification Banner */}
      {showNotificationBanner && notificationMessage && (
        <div className="bg-gray-800 text-white rounded-lg p-4 space-y-3">
          <p className="text-sm font-medium whitespace-pre-line">
            {notificationMessage}
          </p>
          <button
            onClick={onBannerAction}
            className="w-full bg-white text-gray-800 py-3 px-4 rounded-lg font-semibold hover:bg-gray-100 transition-colors"
          >
            {bannerActionLabel}
          </button>
        </div>
      )}

      {/* Date Selection */}
      <div>
        <DateSelector
          dates={dates}
          selectedDateId={selectedDateId}
          onSelectDate={onSelectDate}
        />
      </div>

      {/* Time Slot Selection */}
      {selectedDateId && (
        <div>
          <TimeSlotGrid
            slots={timeSlots}
            selectedSlotId={selectedTimeSlotId}
            onSelectSlot={onSelectTimeSlot}
            slotsPerRow={3}
          />
        </div>
      )}

      {/* Customer Info Form */}
      {selectedTimeSlotId && (
        <div className="bg-gray-50 p-5 rounded-lg">
          <h3 className="text-base font-semibold text-gray-900 mb-4">
            Kişisel Bilgiler
          </h3>
          <BookingInfoForm
            data={formData}
            onChange={onFormChange}
            showBirthDate={true}
          />
        </div>
      )}

      {/* Proceed Button */}
      {selectedDateId && selectedTimeSlotId && (
        <PrimaryActionButton
          label={proceedLabel}
          onClick={onProceed}
        />
      )}

      {/* Mobile Safe Bottom Spacing */}
      <div className="h-4" />
    </div>
  );
};
