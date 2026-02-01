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
    <div className="bg-white rounded-[24px] p-5 shadow-[0_2px_8px_rgba(0,0,0,0.04)] border border-gray-100">
      <div className="flex items-center gap-2 mb-4">
        <Calendar className="w-5 h-5 text-[#D4AF37]" />
        <h3 className="font-semibold text-[#2D2D2D] text-[15px]">Tarih Seçin</h3>
      </div>

      <div className="flex gap-3 overflow-x-auto pb-2 scrollbar-hide">
        {dates.map((date) => (
          <button
            key={date.fullDate}
            onClick={() => onDateSelect(date.fullDate)}
            className={`flex-shrink-0 w-[72px] h-[84px] rounded-2xl flex flex-col items-center justify-center transition-all cursor-pointer ${
              selectedDate === date.fullDate
                ? 'bg-[#D4AF37] text-white shadow-md'
                : date.available
                ? 'bg-[#F9FAFB] hover:bg-gray-100 text-[#4B5563]'
                : 'bg-[#F3F4F6] text-[#9CA3AF]'
            }`}
          >
            <div className={`text-[13px] mb-1 font-medium ${selectedDate === date.fullDate ? 'text-white/90' : ''}`}>
              {date.day}
            </div>
            <div className="text-xl font-bold">{date.date}</div>
            {!date.available && (
              <div className="text-[10px] mt-1 font-medium opacity-80">Dolu</div>
            )}
          </button>
        ))}
      </div>

      {/* Waitlist Visual */}
      {showWaitlist && (
        <div className="mt-4 transition-all animate-in slide-in-from-top-2 fade-in duration-200">
          {!waitlistSubmitted ? (
            <div className="bg-gradient-to-r from-[#2D2D2D] to-[#3D3D3D] rounded-2xl p-4">
              <div className="flex items-start gap-3 mb-3">
                <div className="w-10 h-10 bg-white/10 rounded-full flex items-center justify-center flex-shrink-0">
                  <UserPlus className="w-5 h-5 text-white" />
                </div>
                <div className="flex-1">
                  <h4 className="font-semibold text-white mb-1 text-sm">
                    Bu Gün İçin Bekleme Listesine Girin
                  </h4>
                  <p className="text-xs text-gray-300 leading-relaxed">
                    Bir yer açılırsa size WhatsApp'tan haber verelim
                  </p>
                </div>
              </div>
              <button
                onClick={onWaitlistSubmit}
                className="w-full bg-white text-[#2D2D2D] rounded-xl px-4 py-2.5 text-sm font-semibold hover:bg-gray-50 transition-colors cursor-pointer"
              >
                Sıraya Gir
              </button>
            </div>
          ) : (
            <div className="bg-[#ECFDF5] border border-[#10B981]/20 rounded-2xl p-4">
              <p className="text-[#059669] font-medium text-center text-sm">
                ✓ Bekleme listesine eklendiniz!
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
