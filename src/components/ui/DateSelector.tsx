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
    <div className="bg-white rounded-[20px] p-4 shadow-sm border border-gray-100">
      <div className="flex items-center gap-2 mb-3">
        <Calendar className="w-5 h-5 text-[#D4AF37]" />
        <h3 className="font-semibold text-[#2D2D2D]">Tarih Seçin</h3>
      </div>

      <div className="flex gap-2 overflow-x-auto pb-2 scrollbar-hide">
        {dates.map((date) => (
          <button
            key={date.fullDate}
            onClick={() => onDateSelect(date.fullDate)}
            className={`flex-shrink-0 w-16 px-3 py-3 rounded-[15px] text-center transition-all cursor-pointer ${
              selectedDate === date.fullDate
                ? 'bg-[#D4AF37] text-white shadow-md'
                : date.available
                ? 'bg-gray-50 hover:bg-gray-100 text-[#2D2D2D]'
                : 'bg-gray-100 text-gray-400'
            }`}
          >
            <div className="text-xs mb-1">{date.day}</div>
            <div className="text-lg font-semibold">{date.date}</div>
            {!date.available && <div className="text-xs mt-1">Dolu</div>}
          </button>
        ))}
      </div>

      {/* Waitlist Visual */}
      {showWaitlist && (
        <div className="mt-4 transition-all">
          {!waitlistSubmitted ? (
            <div className="bg-gradient-to-r from-[#2D2D2D] to-[#3D3D3D] rounded-[15px] p-4">
              <div className="flex items-start gap-3 mb-3">
                <div className="w-10 h-10 bg-white/10 rounded-full flex items-center justify-center flex-shrink-0">
                  <UserPlus className="w-5 h-5 text-white" />
                </div>
                <div className="flex-1">
                  <h4 className="font-semibold text-white mb-1">
                    Bu Gün İçin Bekleme Listesine Girin
                  </h4>
                  <p className="text-sm text-gray-300">
                    Bir yer açılırsa size WhatsApp'tan haber verelim
                  </p>
                </div>
              </div>
              <button
                onClick={onWaitlistSubmit}
                className="w-full bg-white text-[#2D2D2D] rounded-[12px] px-4 py-3 font-semibold hover:bg-gray-100 transition-colors cursor-pointer"
              >
                Sıraya Gir
              </button>
            </div>
          ) : (
            <div className="bg-[#10B981]/10 border border-[#10B981]/30 rounded-[15px] p-4">
              <p className="text-[#10B981] font-medium text-center">
                ✓ Bekleme listesine eklendiniz! Bir yer açılırsa sizi haberdar
                edeceğiz.
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
