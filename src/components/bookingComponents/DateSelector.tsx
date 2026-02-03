import React from 'react';

interface DateOption {
  id: string;
  date: Date;
  dayOfMonth: number;
  dayName: string;
  available: boolean;
}

export interface DateSelectorProps {
  dates: DateOption[];
  selectedDateId?: string;
  onSelectDate: (dateId: string) => void;
  label?: string;
}

export const DateSelector: React.FC<DateSelectorProps> = ({
  dates,
  selectedDateId,
  onSelectDate,
  label = 'Tarih Seçin',
}) => {
  return (
    <div className="w-full">
      {label && (
        <h3 className="text-sm font-semibold text-gray-700 mb-3 flex items-center gap-2">
          <span className="text-amber-600">📅</span>
          {label}
        </h3>
      )}
      <div className="flex gap-3 overflow-x-auto pb-2">
        {dates.map((dateOption) => (
          <button
            key={dateOption.id}
            onClick={() => dateOption.available && onSelectDate(dateOption.id)}
            disabled={!dateOption.available}
            className={`flex flex-col items-center justify-center p-3 rounded-lg min-w-[70px] transition-all duration-200 ${
              selectedDateId === dateOption.id
                ? 'bg-amber-600 text-white shadow-md scale-105'
                : 'bg-white text-gray-900 border border-gray-200 hover:border-amber-300'
            } ${!dateOption.available ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}
            aria-pressed={selectedDateId === dateOption.id}
            aria-disabled={!dateOption.available}
          >
            <span className="text-xs font-semibold text-gray-500 uppercase">
              {dateOption.dayName.slice(0, 3)}
            </span>
            <span className="text-lg font-bold mt-1">{dateOption.dayOfMonth}</span>
          </button>
        ))}
      </div>
    </div>
  );
};
