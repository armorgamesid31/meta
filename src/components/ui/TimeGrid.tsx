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
    <div className="bg-white rounded-[12px] p-3 shadow-sm border border-gray-100">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-1.5">
          <Clock className="w-3.5 h-3.5 text-[#BC952B]" />
          <h3 className="font-bold text-[#1a1a1a] text-[12px]">Saat Seçin</h3>
        </div>
        {totalDuration > 0 && (
          <span className="text-[8px] font-bold text-[#6b7280] bg-[#f3f4f6] px-1.5 py-0.5 rounded-sm border border-gray-200">
            ~{totalDuration} dk
          </span>
        )}
      </div>

      <div className="space-y-2.5">
        {/* Morning */}
        {timeSlots.morning.length > 0 && (
          <div>
            <p className="text-[9px] text-[#9ca3af] font-bold uppercase tracking-tight mb-2 ml-0.5">Sabah</p>
            <div className="grid grid-cols-3 gap-1.5">
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
                    className={`h-10 rounded-[10px] text-[11px] font-bold transition-all cursor-pointer flex flex-col items-center justify-center ${
                      isSelected
                        ? 'bg-[#BC952B] text-white shadow-md'
                        : 'bg-white border border-gray-200 hover:border-[#BC952B] hover:bg-[#FFF9E5] text-[#374151]'
                    }`}
                  >
                    <div>{time}</div>
                    {isSelected && endTime && (
                      <div className="text-[7px] mt-0.5 text-white/75 font-semibold leading-none">
                        {endTime}
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
            <p className="text-[9px] text-[#9ca3af] font-bold uppercase tracking-tight mb-2 ml-0.5">Öğle</p>
            <div className="grid grid-cols-3 gap-1.5">
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
                    className={`h-10 rounded-[10px] text-[11px] font-bold transition-all cursor-pointer flex flex-col items-center justify-center ${
                      isSelected
                        ? 'bg-[#BC952B] text-white shadow-md'
                        : 'bg-white border border-gray-200 hover:border-[#BC952B] hover:bg-[#FFF9E5] text-[#374151]'
                    }`}
                  >
                    <div>{time}</div>
                    {isSelected && endTime && (
                      <div className="text-[7px] mt-0.5 text-white/75 font-semibold leading-none">
                        {endTime}
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
            <p className="text-[9px] text-[#9ca3af] font-bold uppercase tracking-tight mb-2 ml-0.5">Akşam</p>
            <div className="grid grid-cols-3 gap-1.5">
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
                    className={`h-10 rounded-[10px] text-[11px] font-bold transition-all cursor-pointer flex flex-col items-center justify-center ${
                      isSelected
                        ? 'bg-[#BC952B] text-white shadow-md'
                        : 'bg-white border border-gray-200 hover:border-[#BC952B] hover:bg-[#FFF9E5] text-[#374151]'
                    }`}
                  >
                    <div>{time}</div>
                    {isSelected && endTime && (
                      <div className="text-[7px] mt-0.5 text-white/75 font-semibold leading-none">
                        {endTime}
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
