import React from 'react';
import { AlertCircle, X } from 'lucide-react';
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
  isToday?: boolean;
  isPast?: boolean;
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
  notificationSubtext?: string;
  onSelectDate: (dateId: string) => void;
  onSelectTimeSlot: (slotId: string) => void;
  onFormChange?: (data: FormData) => void;
  onProceed?: () => void;
  proceedLabel?: string;
  bannerActionLabel?: string;
  onBannerAction?: () => void;
  showTimeGrouping?: boolean;
  bannerDismissible?: boolean;
  onBannerDismiss?: () => void;
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
  notificationMessage = 'Bu Gün İçin Bekleme Listesine Girin',
  notificationSubtext = 'Bir yer açılırsa size WhatsApp\'tan haber verelim',
  onSelectDate,
  onSelectTimeSlot,
  onFormChange,
  onProceed,
  proceedLabel = 'Randevuyu Tamamla',
  bannerActionLabel = 'Sıraya Gir',
  onBannerAction,
  showTimeGrouping = true,
  bannerDismissible = true,
  onBannerDismiss,
}) => {
  const [isBannerVisible, setIsBannerVisible] = React.useState(true);

  const handleBannerDismiss = () => {
    setIsBannerVisible(false);
    onBannerDismiss?.();
  };

  return (
    <div className="w-full max-w-2xl mx-auto space-y-6 pb-8">
      {/* Header */}
      {title && (
        <div className="text-center px-4">
          <h1 className="text-3xl font-bold text-gray-900">{title}</h1>
          {subtitle && <p className="text-gray-600 text-base mt-2">{subtitle}</p>}
        </div>
      )}

      {/* Notification Banner */}
      {showNotificationBanner && notificationMessage && isBannerVisible && (
        <div className="mx-4 bg-gray-800 text-white rounded-lg p-5 space-y-4">
          <div className="flex items-start gap-3">
            <AlertCircle className="w-5 h-5 flex-shrink-0 mt-0.5" />
            <div className="flex-1">
              <p className="font-semibold text-base">{notificationMessage}</p>
              {notificationSubtext && (
                <p className="text-sm text-gray-300 mt-1">{notificationSubtext}</p>
              )}
            </div>
            {bannerDismissible && (
              <button
                onClick={handleBannerDismiss}
                className="flex-shrink-0 text-gray-400 hover:text-white transition-colors"
                aria-label="بستن اطلاع"
              >
                <X className="w-5 h-5" />
              </button>
            )}
          </div>
          <button
            onClick={onBannerAction}
            className="w-full bg-white text-gray-800 py-3 px-4 rounded-lg font-semibold hover:bg-gray-100 transition-colors"
          >
            {bannerActionLabel}
          </button>
        </div>
      )}

      {/* Date Selection */}
      <div className="px-4">
        <DateSelector
          dates={dates}
          selectedDateId={selectedDateId}
          onSelectDate={onSelectDate}
        />
      </div>

      {/* Time Slot Selection */}
      {selectedDateId && (
        <div className="px-4">
          <TimeSlotGrid
            slots={timeSlots}
            selectedSlotId={selectedTimeSlotId}
            onSelectSlot={onSelectTimeSlot}
            slotsPerRow={3}
            groupByPeriod={showTimeGrouping}
          />
        </div>
      )}

      {/* Customer Info Form */}
      {selectedTimeSlotId && (
        <div className="mx-4 bg-white p-6 rounded-lg border border-gray-200">
          <h3 className="text-base font-bold text-gray-900 mb-5">
            Randevu Bilgileri
          </h3>
          <BookingInfoForm
            data={formData}
            onChange={onFormChange}
            showBirthDate={true}
            showOptionalCheckbox={true}
          />
        </div>
      )}

      {/* Proceed Button */}
      {selectedDateId && selectedTimeSlotId && formData?.name && (
        <div className="px-4">
          <PrimaryActionButton
            label={proceedLabel}
            onClick={onProceed}
            size="lg"
            fullWidth
          />
        </div>
      )}

      {/* Mobile Safe Bottom Spacing */}
      <div className="h-6" />
    </div>
  );
};
