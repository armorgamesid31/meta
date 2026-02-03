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
    <div className="bg-[#FFFDF5] rounded-[16px] border border-[#EAB308]/30 p-4 shadow-sm flex items-center justify-between gap-3">
      <div className="flex items-center gap-3 flex-1 min-w-0">
        <div className="w-12 h-12 bg-[#BC952B] rounded-full flex items-center justify-center flex-shrink-0 shadow-sm">
          <Users className="w-5 h-5 text-white" />
        </div>
        <div className="flex flex-col min-w-0">
          <h3 className="font-bold text-[#1a1a1a] text-[12px] leading-snug">
            Randevuna arkadaşını ekle,
            <br />
            anında 100 TL kazan!
          </h3>
          <p className="text-[10px] text-[#6b7280] font-medium mt-0.5">
            Hem sen hem de arkadaşın indirim kazanın
          </p>
        </div>
      </div>

      <button
        onClick={onToggle}
        className={`relative w-12 h-7 rounded-full transition-all flex-shrink-0 cursor-pointer ${
          isActive ? 'bg-[#BC952B]' : 'bg-[#D1D5DB]'
        }`}
      >
        <div
          className={`absolute top-0.5 w-6 h-6 bg-white rounded-full shadow-md transition-all ${
            isActive ? 'left-[22px]' : 'left-0.5'
          }`}
        />
      </button>
    </div>
  );
}
