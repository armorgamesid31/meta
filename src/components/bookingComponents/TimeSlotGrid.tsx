import React from 'react';
import { TimeSlot } from './types';

export interface TimeSlotGridProps {
  slots: TimeSlot[];
  selectedSlotId?: string;
  onSelectSlot: (slotId: string) => void;
  label?: string;
  slotsPerRow?: number;
}

export const TimeSlotGrid: React.FC<TimeSlotGridProps> = ({
  slots,
  selectedSlotId,
  onSelectSlot,
  label = 'Saat Seçin',
  slotsPerRow = 3,
}) => {
  return (
    <div className="w-full">
      {label && (
        <h3 className="text-sm font-semibold text-gray-700 mb-3 flex items-center gap-2">
          <span className="text-amber-600">⏰</span>
          {label}
        </h3>
      )}
      <div
        className={`grid gap-2`}
        style={{ gridTemplateColumns: `repeat(${slotsPerRow}, 1fr)` }}
      >
        {slots.map((slot) => (
          <button
            key={slot.id}
            onClick={() => slot.available && onSelectSlot(slot.id)}
            disabled={!slot.available}
            className={`py-3 px-4 rounded-lg font-medium text-sm transition-all duration-200 ${
              selectedSlotId === slot.id
                ? 'bg-amber-600 text-white shadow-md scale-105'
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
  );
};
