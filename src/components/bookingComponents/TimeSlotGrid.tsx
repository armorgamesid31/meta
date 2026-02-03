import React from 'react';
import { Clock } from 'lucide-react';
import { TimeSlot } from './types';

export interface TimeSlotGridProps {
  slots: TimeSlot[];
  selectedSlotId?: string;
  onSelectSlot: (slotId: string) => void;
  label?: string;
  slotsPerRow?: number;
  groupByPeriod?: boolean;
}

interface GroupedSlots {
  [period: string]: TimeSlot[];
}

export const TimeSlotGrid: React.FC<TimeSlotGridProps> = ({
  slots,
  selectedSlotId,
  onSelectSlot,
  label = 'Saat Seçin',
  slotsPerRow = 3,
  groupByPeriod = false,
}) => {
  const getTimePeriod = (time: string): string => {
    const hour = parseInt(time.split(':')[0]);
    if (hour < 12) return 'Sabah';
    if (hour < 17) return 'Öğle';
    if (hour < 21) return 'Akşam';
    return 'Gece';
  };

  const groupedSlots: GroupedSlots = groupByPeriod
    ? slots.reduce((acc, slot) => {
        const period = getTimePeriod(slot.time);
        if (!acc[period]) acc[period] = [];
        acc[period].push(slot);
        return acc;
      }, {} as GroupedSlots)
    : { 'Tüm Saatler': slots };

  const periods = ['Sabah', 'Öğle', 'Akşam', 'Gece'];
  const orderedGroups = groupByPeriod
    ? periods.filter((p) => groupedSlots[p])
    : ['Tüm Saatler'];

  return (
    <div className="w-full bg-white p-4 rounded-lg">
      {label && (
        <h3 className="text-sm font-semibold text-gray-700 mb-4 flex items-center gap-2">
          <Clock className="w-4 h-4 text-amber-600" />
          {label}
        </h3>
      )}
      <div className="space-y-5">
        {orderedGroups.map((period) => (
          <div key={period}>
            {groupByPeriod && (
              <h4 className="text-xs font-semibold text-gray-600 uppercase mb-2">
                {period}
              </h4>
            )}
            <div
              className={`grid gap-2`}
              style={{ gridTemplateColumns: `repeat(${slotsPerRow}, 1fr)` }}
            >
              {groupedSlots[period].map((slot) => (
                <button
                  key={slot.id}
                  onClick={() => slot.available && onSelectSlot(slot.id)}
                  disabled={!slot.available}
                  className={`py-3 px-3 rounded-lg font-semibold text-sm transition-all duration-200 ${
                    selectedSlotId === slot.id
                      ? 'bg-amber-600 text-white shadow-md'
                      : 'bg-gray-100 text-gray-900 border border-gray-200 hover:bg-gray-50'
                  } ${!slot.available ? 'opacity-40 cursor-not-allowed' : 'cursor-pointer'}`}
                  aria-pressed={selectedSlotId === slot.id}
                  aria-disabled={!slot.available}
                >
                  {slot.time}
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};
