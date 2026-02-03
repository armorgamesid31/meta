import { Users } from 'lucide-react';

interface ReferralBannerProps {
  isActive: boolean;
  phoneValue: string;
  onToggle: () => void;
  onPhoneChange: (phone: string) => void;
}

export function ReferralBanner({
  isActive,
  onToggle,
}: ReferralBannerProps) {
  return (
    <div className="bg-[#FFFDF5] rounded-[12px] border border-[#EAB308]/30 p-2.5 shadow-sm flex items-center justify-between gap-2">
      <div className="flex items-center gap-2 flex-1 min-w-0">
        <div className="w-9 h-9 bg-[#BC952B] rounded-full flex items-center justify-center flex-shrink-0 shadow-sm">
          <Users className="w-4 h-4 text-white" />
        </div>
        <div className="flex flex-col min-w-0">
          <h3 className="font-bold text-[#1a1a1a] text-[11px] leading-snug">
            Randevuna arkadaşını ekle,
            <br />
            anında 100 TL kazan!
          </h3>
          <p className="text-[9px] text-[#6b7280] font-medium mt-0">
            Hem sen hem de arkadaşın indirim kazanın
          </p>
        </div>
      </div>

      <button
        onClick={onToggle}
        className={`relative w-10 h-6 rounded-full transition-all flex-shrink-0 cursor-pointer ${
          isActive ? 'bg-[#BC952B]' : 'bg-[#D1D5DB]'
        }`}
      >
        <div
          className={`absolute top-0.5 w-5 h-5 bg-white rounded-full shadow-md transition-all ${
            isActive ? 'left-[18px]' : 'left-0.5'
          }`}
        />
      </button>
    </div>
  );
}
