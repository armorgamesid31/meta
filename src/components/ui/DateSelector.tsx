import { Calendar, UserPlus } from 'lucide-react';

interface DateObj {
  day: string;
  date: string;
  fullDate: string;
  available: boolean;
}

interface DateSelectorProps {
  dates: DateObj[];
  selectedDate?: string;
  onDateSelect: (date: string) => void;
  showWaitlist?: boolean;
  waitlistSubmitted?: boolean;
  onWaitlistSubmit?: () => void;
}

export function DateSelector({
  dates,
  selectedDate,
  onDateSelect,
  showWaitlist,
  waitlistSubmitted,
  onWaitlistSubmit,
}: DateSelectorProps) {
  return (
    <div className="bg-white rounded-[12px] p-3 shadow-sm border border-gray-100">
      <div className="flex items-center gap-1.5 mb-3">
        <Calendar className="w-3.5 h-3.5 text-[#BC952B]" />
        <h3 className="font-bold text-[#1a1a1a] text-[12px]">Tarih Seçin</h3>
      </div>

      <div className="flex gap-1.5 overflow-x-auto pb-1.5 scrollbar-hide">
        {dates.map((date) => (
          <button
            key={date.fullDate}
            onClick={() => onDateSelect(date.fullDate)}
            className={`flex-shrink-0 w-[60px] h-[70px] rounded-[12px] flex flex-col items-center justify-center transition-all cursor-pointer ${
              selectedDate === date.fullDate
                ? 'bg-[#BC952B] text-white shadow-lg border-0'
                : date.available
                ? 'bg-white hover:bg-gray-50 text-[#4B5563] border border-gray-200 hover:border-[#BC952B]'
                : 'bg-gray-100 text-[#9CA3AF] border border-gray-200'
            }`}
          >
            <div className={`text-[9px] mb-1 font-bold tracking-wide ${selectedDate === date.fullDate ? 'text-white/85' : 'text-[#6b7280]'}`}>
              {date.day}
            </div>
            <div className={`text-base font-black ${selectedDate === date.fullDate ? 'text-white' : 'text-[#1a1a1a]'}`}>{date.date}</div>
            {!date.available && (
              <div className="text-[8px] mt-0.5 font-bold opacity-75">Dolu</div>
            )}
          </button>
        ))}
      </div>

      {/* Waitlist Visual */}
      {showWaitlist && (
        <div className="mt-2 transition-all">
          {!waitlistSubmitted ? (
            <div className="bg-[#1f2937] rounded-lg p-2.5 shadow-lg border border-white/5">
              <div className="flex items-start gap-2 mb-2">
                <div className="w-8 h-8 bg-white/10 rounded-full flex items-center justify-center flex-shrink-0">
                  <UserPlus className="w-4 h-4 text-white" />
                </div>
                <div className="flex-1">
                  <h4 className="font-bold text-white mb-0 text-xs">
                    Bu Gün İçin Bekleme Listesine Girin
                  </h4>
                  <p className="text-[10px] text-gray-400 font-medium leading-tight">
                    Bir yer açılırsa size WhatsApp'tan haber verelim
                  </p>
                </div>
              </div>
              <button
                onClick={onWaitlistSubmit}
                className="w-full bg-white text-[#1f2937] rounded-lg py-1.5 text-[11px] font-black hover:bg-gray-100 transition-all cursor-pointer shadow-sm active:scale-[0.98]"
              >
                Sıraya Gir
              </button>
            </div>
          ) : (
            <div className="bg-[#ECFDF5] border border-[#10B981]/20 rounded-lg p-2.5 animate-in fade-in zoom-in-95 duration-300">
              <p className="text-[#059669] font-bold text-center text-xs">
                ✓ Bekleme listesine eklendiniz!
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
