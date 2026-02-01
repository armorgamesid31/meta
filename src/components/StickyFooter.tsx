import { Calculator } from 'lucide-react';

interface StickyFooterProps {
  originalPrice: number;
  finalPrice: number;
  hasDiscount: boolean;
  isEnabled: boolean;
  onConfirm: () => void;
  onShowBreakdown: () => void;
}

export function StickyFooter({
  originalPrice,
  finalPrice,
  hasDiscount,
  isEnabled,
  onConfirm,
  onShowBreakdown
}: StickyFooterProps) {
  const savings = originalPrice - finalPrice;

  return (
    <div className="fixed bottom-0 left-0 right-0 bg-white/95 backdrop-blur-md border-t border-gray-200 px-4 py-4 shadow-lg">
      <div className="max-w-md mx-auto">
        {/* Price Summary */}
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-3">
            <button
              onClick={onShowBreakdown}
              className="flex items-center gap-2 text-[#D4AF37] hover:text-[#B8941F] transition-colors"
            >
              <Calculator className="w-4 h-4" />
              <span className="text-sm font-medium">Fiyat Detayı</span>
            </button>

            {hasDiscount && (
              <div className="bg-green-100 text-green-800 text-xs px-2 py-1 rounded-full font-medium">
                {savings}₺ indirim
              </div>
            )}
          </div>

          <div className="text-right">
            {hasDiscount && originalPrice !== finalPrice ? (
              <>
                <p className="text-sm text-gray-400 line-through">{originalPrice}₺</p>
                <p className="text-xl font-bold text-[#2D2D2D]">{finalPrice}₺</p>
              </>
            ) : (
              <p className="text-xl font-bold text-[#2D2D2D]">{finalPrice}₺</p>
            )}
          </div>
        </div>

        {/* Confirm Button */}
        <button
          onClick={onConfirm}
          disabled={!isEnabled}
          className={`w-full py-4 px-6 rounded-xl font-bold text-lg transition-all shadow-lg ${
            isEnabled
              ? 'bg-gradient-to-r from-[#D4AF37] to-[#F4D03F] text-white hover:from-[#B8941F] hover:to-[#E6C84A] transform hover:scale-[1.02]'
              : 'bg-gray-200 text-gray-400 cursor-not-allowed'
          }`}
        >
          {isEnabled ? 'Randevuyu Onayla →' : 'Tarih ve Saat Seçin'}
        </button>
      </div>
    </div>
  );
}