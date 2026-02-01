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
    <div className="fixed bottom-0 left-0 right-0 bg-white border-t border-gray-100 shadow-[0_-8px_24px_rgba(0,0,0,0.06)] z-50 px-5 py-4 safe-bottom">
      <div className="max-w-md mx-auto flex items-center justify-between gap-6">
        {/* Price Section */}
        <button
          onClick={onShowBreakdown}
          className="flex flex-col items-start cursor-pointer group"
        >
          <div className="flex items-center gap-1.5">
            <p className="text-[22px] font-black text-[#1a1a1a] tracking-tight">{finalPrice} TL</p>
            <ChevronUp className="w-5 h-5 text-[#9ca3af] group-hover:text-[#BC952B] transition-colors" strokeWidth={3} />
          </div>
          <p className="text-[11px] text-[#6b7280] font-bold">Detayı gör</p>
        </button>

        {/* Confirm Button */}
        <button
          onClick={onConfirm}
          disabled={!isEnabled}
          className={`flex-1 h-[56px] rounded-[18px] font-black text-[16px] transition-all cursor-pointer shadow-md tracking-tight ${
            isEnabled
              ? 'bg-[#BC952B] text-white hover:bg-[#A68325] active:scale-[0.97]'
              : 'bg-gray-300 text-gray-500 cursor-not-allowed shadow-none'
          }`}
        >
          Randevuyu Onayla
        </button>
      </div>
    </div>
  );
}
