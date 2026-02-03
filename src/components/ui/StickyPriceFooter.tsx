import { ChevronUp } from 'lucide-react';

interface StickyPriceFooterProps {
  originalPrice: number;
  finalPrice: number;
  showDiscount: boolean;
  isEnabled: boolean;
  onConfirm: () => void;
  onShowBreakdown: () => void;
}

export function StickyPriceFooter({
  finalPrice,
  isEnabled,
  onConfirm,
  onShowBreakdown,
}: StickyPriceFooterProps) {
  return (
    <div className="fixed bottom-0 left-0 right-0 bg-white border-t border-gray-100 shadow-[0_-12px_32px_rgba(0,0,0,0.08)] z-50 px-5 py-4 safe-bottom">
      <div className="max-w-md mx-auto flex items-center justify-between gap-4">
        {/* Price Section */}
        <button
          onClick={onShowBreakdown}
          className="flex flex-col items-start cursor-pointer group transition-all"
        >
          <div className="flex items-center gap-1.5">
            <p className="text-[24px] font-black text-[#1a1a1a] tracking-tight">{finalPrice}</p>
            <span className="text-[12px] font-bold text-[#6b7280]">TL</span>
            <ChevronUp className="w-5 h-5 text-[#9ca3af] group-hover:text-[#BC952B] transition-colors" strokeWidth={3} />
          </div>
          <p className="text-[10px] text-[#9ca3af] font-bold">Detayı gör</p>
        </button>

        {/* Confirm Button */}
        <button
          onClick={onConfirm}
          disabled={!isEnabled}
          className={`flex-1 h-[50px] rounded-[16px] font-black text-[14px] transition-all cursor-pointer tracking-tight ${
            isEnabled
              ? 'bg-[#BC952B] text-white hover:bg-[#A68325] active:scale-[0.97] shadow-lg hover:shadow-xl'
              : 'bg-gray-300 text-gray-500 cursor-not-allowed shadow-none'
          }`}
        >
          Randevuyu Onayla
        </button>
      </div>
    </div>
  );
}
