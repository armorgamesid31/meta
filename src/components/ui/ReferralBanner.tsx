import { Users, Phone } from 'lucide-react';

interface ReferralBannerProps {
  isActive: boolean;
  phoneValue: string;
  onToggle: () => void;
  onPhoneChange: (phone: string) => void;
}

export function ReferralBanner({
  isActive,
  phoneValue,
  onToggle,
  onPhoneChange,
}: ReferralBannerProps) {
  const handlePhoneInput = (value: string) => {
    const cleaned = value.replace(/\D/g, '').slice(0, 10);
    onPhoneChange(cleaned);
  };

  return (
    <div className="bg-[#FFFDF5] rounded-2xl border border-[#EAB308] p-4 shadow-sm">
      <div className="flex items-start justify-between gap-3 mb-3">
        <div className="flex items-start gap-3 flex-1">
          <div className="w-12 h-12 bg-[#D4AF37] rounded-full flex items-center justify-center flex-shrink-0 shadow-sm">
            <Users className="w-6 h-6 text-white" />
          </div>
          <div>
            <h3 className="font-semibold text-[#2D2D2D] mb-1 text-[13px] leading-tight">
              Randevuna arkadaşını ekle, anında
              <br />
              100 TL kazan!
            </h3>
            <p className="text-[11px] text-gray-600 leading-tight">
              Hem sen hem de arkadaşın indirim kazanın
            </p>
          </div>
        </div>

        <button
          onClick={onToggle}
          className={`relative w-12 h-7 rounded-full transition-colors flex-shrink-0 cursor-pointer border border-transparent ${
            isActive ? 'bg-[#D4AF37]' : 'bg-gray-300'
          }`}
          aria-label="Kampanyayı aktif et"
        >
          <div
            className={`absolute top-0.5 w-6 h-6 bg-white rounded-full shadow-md transition-all ${
              isActive ? 'left-[22px]' : 'left-0.5'
            }`}
          />
        </button>
      </div>

      {isActive && (
        <div className="mt-3 transition-all animate-in slide-in-from-top-2 fade-in duration-200">
          <div className="relative">
            <Phone className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <input
              type="tel"
              placeholder="Arkadaşının Telefon Numarası"
              value={phoneValue}
              onChange={(e) => handlePhoneInput(e.target.value)}
              className="w-full bg-white rounded-xl pl-10 pr-4 py-2.5 text-sm text-[#2D2D2D] placeholder:text-gray-400 border border-[#D4AF37]/30 focus:outline-none focus:ring-2 focus:ring-[#D4AF37]/50 focus:border-[#D4AF37]"
              maxLength={10}
              aria-label="Telefon numarası"
            />
            {phoneValue.length > 0 && (
              <div className="absolute right-3 top-1/2 -translate-y-1/2 text-[10px] text-gray-500 font-medium">
                {phoneValue.length}/10
              </div>
            )}
          </div>
          {phoneValue.length === 10 && (
            <p className="text-[11px] text-[#15803d] mt-2 flex items-center gap-1 font-medium">
              ✓ 100 TL indirim tüm hizmetlere uygulanacak
            </p>
          )}
        </div>
      )}
    </div>
  );
}
