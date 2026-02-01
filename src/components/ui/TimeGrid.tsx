import { Clock } from 'lucide-react';

interface TimeSlots {
  morning: string[];
  afternoon: string[];
  evening: string[];
}

interface TimeGridProps {
  timeSlots: TimeSlots;
  selectedTime?: string;
  onTimeSelect: (time: string) => void;
  totalDuration?: number;
}

function calculateEndTime(startTime: string, durationMinutes: number): string {
  const [hours, minutes] = startTime.split(':').map(Number);
  const totalMinutes = hours * 60 + minutes + durationMinutes;
  const endHours = Math.floor(totalMinutes / 60);
  const endMinutes = totalMinutes % 60;
  return `${String(endHours).padStart(2, '0')}:${String(endMinutes).padStart(2, '0')}`;
}

export function TimeGrid({
  timeSlots,
  selectedTime,
  onTimeSelect,
  totalDuration = 0,
}: TimeGridProps) {
  return (
    <div className="bg-white rounded-[20px] p-4 shadow-sm border border-gray-100">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <Clock className="w-5 h-5 text-[#D4AF37]" />
          <h3 className="font-semibold text-[#2D2D2D]">Saat Seçin</h3>
        </div>
        {totalDuration > 0 && (
          <span className="text-sm text-gray-500">
            ~{totalDuration} dakika
          </span>
        )}
      </div>

      <div className="space-y-4">
        {/* Morning */}
        {timeSlots.morning.length > 0 && (
          <div>
            <p className="text-sm text-gray-500 mb-2">Sabah</p>
            <div className="grid grid-cols-3 gap-2">
              {timeSlots.morning.map((time) => {
                const endTime =
                  totalDuration > 0
                    ? calculateEndTime(time, totalDuration)
                    : null;
                const isSelected = selectedTime === time;

                return (
                  <button
                    key={time}
                    onClick={() => onTimeSelect(time)}
                    className={`w-full py-3 px-2 rounded-[12px] text-sm font-medium transition-all cursor-pointer ${
                      isSelected
                        ? 'bg-[#D4AF37] text-white shadow-md'
                        : 'bg-gray-50 hover:bg-gray-100 text-[#2D2D2D]'
                    }`}
                  >
                    <div>{time}</div>
                    {isSelected && endTime && (
                      <div className="text-xs mt-1 text-white/80">
                        - {endTime}
                      </div>
                    )}
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* Afternoon */}
        {timeSlots.afternoon.length > 0 && (
          <div>
            <p className="text-sm text-gray-500 mb-2">Öğle</p>
            <div className="grid grid-cols-3 gap-2">
              {timeSlots.afternoon.map((time) => {
                const endTime =
                  totalDuration > 0
                    ? calculateEndTime(time, totalDuration)
                    : null;
                const isSelected = selectedTime === time;

                return (
                  <button
                    key={time}
                    onClick={() => onTimeSelect(time)}
                    className={`w-full py-3 px-2 rounded-[12px] text-sm font-medium transition-all cursor-pointer ${
                      isSelected
                        ? 'bg-[#D4AF37] text-white shadow-md'
                        : 'bg-gray-50 hover:bg-gray-100 text-[#2D2D2D]'
                    }`}
                  >
                    <div>{time}</div>
                    {isSelected && endTime && (
                      <div className="text-xs mt-1 text-white/80">
                        - {endTime}
                      </div>
                    )}
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* Evening */}
        {timeSlots.evening.length > 0 && (
          <div>
            <p className="text-sm text-gray-500 mb-2">Akşam</p>
            <div className="grid grid-cols-3 gap-2">
              {timeSlots.evening.map((time) => {
                const endTime =
                  totalDuration > 0
                    ? calculateEndTime(time, totalDuration)
                    : null;
                const isSelected = selectedTime === time;

                return (
                  <button
                    key={time}
                    onClick={() => onTimeSelect(time)}
                    className={`w-full py-3 px-2 rounded-[12px] text-sm font-medium transition-all cursor-pointer ${
                      isSelected
                        ? 'bg-[#D4AF37] text-white shadow-md'
                        : 'bg-gray-50 hover:bg-gray-100 text-[#2D2D2D]'
                    }`}
                  >
                    <div>{time}</div>
                    {isSelected && endTime && (
                      <div className="text-xs mt-1 text-white/80">
                        - {endTime}
                      </div>
                    )}
                  </button>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
