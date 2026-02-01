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
  originalPrice,
  finalPrice,
  showDiscount,
  isEnabled,
  onConfirm,
  onShowBreakdown,
}: StickyPriceFooterProps) {
  return (
    <div className="fixed bottom-0 left-0 right-0 bg-white border-t border-gray-200 shadow-[0_-4px_16px_rgba(0,0,0,0.04)] z-50 animate-in slide-in-from-bottom duration-300">
      <div className="max-w-md mx-auto px-5 py-4 flex items-center justify-between gap-4">
        {/* Price Section */}
        <button
          onClick={onShowBreakdown}
          className="flex flex-col items-start hover:opacity-80 transition-opacity cursor-pointer group"
          aria-label="Fiyat detayını göster"
        >
          <div className="flex items-center gap-2">
            <p className="text-2xl font-bold text-[#2D2D2D]">{finalPrice} TL</p>
            <ChevronUp className="w-5 h-5 text-gray-400 group-hover:text-gray-600 transition-colors" />
          </div>
          <p className="text-[11px] text-gray-500 font-medium">Detayı gör</p>
        </button>

        {/* Confirm Button */}
        <button
          onClick={onConfirm}
          disabled={!isEnabled}
          className={`flex-1 py-4 px-6 rounded-2xl font-bold text-white text-[15px] transition-all cursor-pointer shadow-md ${
            isEnabled
              ? 'bg-[#D4A32E] hover:bg-[#B45309] hover:shadow-lg active:scale-[0.98]'
              : 'bg-gray-300 cursor-not-allowed'
          }`}
          aria-label="Randevuyu onayla"
        >
          Randevuyu Onayla
        </button>
      </div>
    </div>
  );
}
