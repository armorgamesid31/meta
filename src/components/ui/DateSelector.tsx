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
    <div className="bg-white rounded-[16px] p-4 shadow-sm border border-gray-100">
      <div className="flex items-center gap-2 mb-4">
        <Calendar className="w-4 h-4 text-[#BC952B]" />
        <h3 className="font-bold text-[#1a1a1a] text-[13px]">Tarih Seçin</h3>
      </div>

      <div className="flex gap-2 overflow-x-auto pb-2 scrollbar-hide">
        {dates.map((date) => (
          <button
            key={date.fullDate}
            onClick={() => onDateSelect(date.fullDate)}
            className={`flex-shrink-0 w-[70px] h-[85px] rounded-[16px] flex flex-col items-center justify-center transition-all cursor-pointer ${
              selectedDate === date.fullDate
                ? 'bg-[#BC952B] text-white shadow-lg border-0'
                : date.available
                ? 'bg-white hover:bg-gray-50 text-[#4B5563] border border-gray-200 hover:border-[#BC952B]'
                : 'bg-gray-100 text-[#9CA3AF] border border-gray-200'
            }`}
          >
            <div className={`text-[11px] mb-1.5 font-bold tracking-wide ${selectedDate === date.fullDate ? 'text-white/85' : 'text-[#6b7280]'}`}>
              {date.day}
            </div>
            <div className={`text-lg font-black ${selectedDate === date.fullDate ? 'text-white' : 'text-[#1a1a1a]'}`}>{date.date}</div>
            {!date.available && (
              <div className="text-[9px] mt-1 font-bold opacity-75">Dolu</div>
            )}
          </button>
        ))}
      </div>

      {/* Waitlist Visual */}
      {showWaitlist && (
        <div className="mt-4 transition-all">
          {!waitlistSubmitted ? (
            <div className="bg-[#1f2937] rounded-2xl p-4 shadow-lg border border-white/5">
              <div className="flex items-start gap-3 mb-3">
                <div className="w-10 h-10 bg-white/10 rounded-full flex items-center justify-center flex-shrink-0">
                  <UserPlus className="w-5 h-5 text-white" />
                </div>
                <div className="flex-1">
                  <h4 className="font-bold text-white mb-0.5 text-sm">
                    Bu Gün İçin Bekleme Listesine Girin
                  </h4>
                  <p className="text-[11px] text-gray-400 font-medium leading-tight">
                    Bir yer açılırsa size WhatsApp'tan haber verelim
                  </p>
                </div>
              </div>
              <button
                onClick={onWaitlistSubmit}
                className="w-full bg-white text-[#1f2937] rounded-xl py-2.5 text-[13px] font-black hover:bg-gray-100 transition-all cursor-pointer shadow-sm active:scale-[0.98]"
              >
                Sıraya Gir
              </button>
            </div>
          ) : (
            <div className="bg-[#ECFDF5] border border-[#10B981]/20 rounded-2xl p-4 animate-in fade-in zoom-in-95 duration-300">
              <p className="text-[#059669] font-bold text-center text-sm">
                ✓ Bekleme listesine eklendiniz!
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
