import { Clock } from 'lucide-react';

interface TimeSlots {
  morning: string[];
  afternoon: string[];
  evening: string[];
}

interface TimeSlotGridProps {
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

export function TimeSlotGrid({
  timeSlots,
  selectedTime,
  onTimeSelect,
  totalDuration = 0,
}: TimeSlotGridProps) {
  return (
    <div className="bg-white rounded-[24px] p-5 shadow-sm border border-gray-100">
      <div className="flex items-center justify-between mb-5">
        <div className="flex items-center gap-2">
          <Clock className="w-5 h-5 text-[#BC952B]" />
          <h3 className="font-bold text-[#1a1a1a] text-[15px]">Saat Seçin</h3>
        </div>
        {totalDuration > 0 && (
          <span className="text-[11px] font-bold text-[#6b7280] bg-[#f3f4f6] px-2 py-0.5 rounded-lg border border-gray-100">
            ~{totalDuration} dakika
          </span>
        )}
      </div>

      <div className="space-y-6">
        {/* Morning */}
        {timeSlots.morning.length > 0 && (
          <div>
            <p className="text-[12px] text-[#9ca3af] font-black uppercase tracking-widest mb-3 ml-0.5">Sabah</p>
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
                    className={`h-[52px] rounded-[16px] text-[14px] font-black transition-all cursor-pointer flex flex-col items-center justify-center border ${
                      isSelected
                        ? 'bg-[#BC952B] text-white border-[#BC952B] shadow-md'
                        : 'bg-[#F9FAFB] hover:bg-white hover:border-[#BC952B]/30 text-[#374151] border-transparent'
                    }`}
                  >
                    <div>{time}</div>
                    {isSelected && endTime && (
                      <div className="text-[10px] mt-0.5 text-white/80 font-bold leading-none">
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
            <p className="text-[12px] text-[#9ca3af] font-black uppercase tracking-widest mb-3 ml-0.5">Öğle</p>
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
                    className={`h-[52px] rounded-[16px] text-[14px] font-black transition-all cursor-pointer flex flex-col items-center justify-center border ${
                      isSelected
                        ? 'bg-[#BC952B] text-white border-[#BC952B] shadow-md'
                        : 'bg-[#F9FAFB] hover:bg-white hover:border-[#BC952B]/30 text-[#374151] border-transparent'
                    }`}
                  >
                    <div>{time}</div>
                    {isSelected && endTime && (
                      <div className="text-[10px] mt-0.5 text-white/80 font-bold leading-none">
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
            <p className="text-[12px] text-[#9ca3af] font-black uppercase tracking-widest mb-3 ml-0.5">Akşam</p>
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
                    className={`h-[52px] rounded-[16px] text-[14px] font-black transition-all cursor-pointer flex flex-col items-center justify-center border ${
                      isSelected
                        ? 'bg-[#BC952B] text-white border-[#BC952B] shadow-md'
                        : 'bg-[#F9FAFB] hover:bg-white hover:border-[#BC952B]/30 text-[#374151] border-transparent'
                    }`}
                  >
                    <div>{time}</div>
                    {isSelected && endTime && (
                      <div className="text-[10px] mt-0.5 text-white/80 font-bold leading-none">
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
