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
    <div className="bg-white rounded-[24px] p-5 shadow-[0_2px_8px_rgba(0,0,0,0.04)] border border-gray-100">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <Clock className="w-5 h-5 text-[#D4AF37]" />
          <h3 className="font-semibold text-[#2D2D2D] text-[15px]">Saat Seçin</h3>
        </div>
        {totalDuration > 0 && (
          <span className="text-xs font-medium text-gray-500">
            ~{totalDuration} dakika
          </span>
        )}
      </div>

      <div className="space-y-5">
        {/* Morning */}
        {timeSlots.morning.length > 0 && (
          <div>
            <p className="text-xs text-gray-500 font-medium mb-2.5 ml-1">Sabah</p>
            <div className="grid grid-cols-3 gap-2.5">
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
                    className={`w-full py-3.5 px-2 rounded-2xl text-[13px] font-medium transition-all cursor-pointer flex flex-col items-center justify-center ${
                      isSelected
                        ? 'bg-[#D4A32E] text-white shadow-md'
                        : 'bg-[#F9FAFB] hover:bg-gray-100 text-[#374151]'
                    }`}
                  >
                    <div>{time}</div>
                    {isSelected && endTime && (
                      <div className="text-[11px] mt-0.5 text-white/90 font-normal">
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
            <p className="text-xs text-gray-500 font-medium mb-2.5 ml-1">Öğle</p>
            <div className="grid grid-cols-3 gap-2.5">
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
                    className={`w-full py-3.5 px-2 rounded-2xl text-[13px] font-medium transition-all cursor-pointer flex flex-col items-center justify-center ${
                      isSelected
                        ? 'bg-[#D4A32E] text-white shadow-md'
                        : 'bg-[#F9FAFB] hover:bg-gray-100 text-[#374151]'
                    }`}
                  >
                    <div>{time}</div>
                    {isSelected && endTime && (
                      <div className="text-[11px] mt-0.5 text-white/90 font-normal">
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
            <p className="text-xs text-gray-500 font-medium mb-2.5 ml-1">Akşam</p>
            <div className="grid grid-cols-3 gap-2.5">
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
                    className={`w-full py-3.5 px-2 rounded-2xl text-[13px] font-medium transition-all cursor-pointer flex flex-col items-center justify-center ${
                      isSelected
                        ? 'bg-[#D4A32E] text-white shadow-md'
                        : 'bg-[#F9FAFB] hover:bg-gray-100 text-[#374151]'
                    }`}
                  >
                    <div>{time}</div>
                    {isSelected && endTime && (
                      <div className="text-[11px] mt-0.5 text-white/90 font-normal">
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
