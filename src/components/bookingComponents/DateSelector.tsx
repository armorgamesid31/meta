import React from 'react';
import { Calendar } from 'lucide-react';

interface DateOption {
  id: string;
  date: Date;
  dayOfMonth: number;
  dayName: string;
  available: boolean;
  isToday?: boolean;
  isPast?: boolean;
}

export interface DateSelectorProps {
  dates: DateOption[];
  selectedDateId?: string;
  onSelectDate: (dateId: string) => void;
  label?: string;
  showDayAbreviations?: boolean;
}

export const DateSelector: React.FC<DateSelectorProps> = ({
  dates,
  selectedDateId,
  onSelectDate,
  label = 'Tarih Seçin',
  showDayAbreviations = true,
}) => {
  return (
    <div className="w-full bg-white p-4 rounded-lg">
      {label && (
        <h3 className="text-sm font-semibold text-gray-700 mb-4 flex items-center gap-2">
          <Calendar className="w-4 h-4 text-amber-600" />
          {label}
        </h3>
      )}
      <div className="flex gap-2 overflow-x-auto pb-2">
        {dates.map((dateOption) => (
          <button
            key={dateOption.id}
            onClick={() => dateOption.available && onSelectDate(dateOption.id)}
            disabled={!dateOption.available}
            className={`flex flex-col items-center justify-center py-2 px-3 rounded-lg min-w-[65px] text-center transition-all duration-200 ${
              selectedDateId === dateOption.id
                ? 'bg-amber-600 text-white shadow-md'
                : dateOption.isPast
                  ? 'bg-gray-100 text-gray-400 border border-gray-200'
                  : 'bg-white text-gray-900 border border-gray-300 hover:border-amber-400'
            } ${!dateOption.available ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}
            aria-pressed={selectedDateId === dateOption.id}
            aria-disabled={!dateOption.available}
            title={dateOption.date.toLocaleDateString('tr-TR')}
          >
            {showDayAbreviations && (
              <span className="text-xs font-medium text-gray-500 mb-1 uppercase">
                {dateOption.dayName.slice(0, 3)}
              </span>
            )}
            <span className="text-base font-bold">{dateOption.dayOfMonth}</span>
          </button>
        ))}
      </div>
    </div>
  );
};
