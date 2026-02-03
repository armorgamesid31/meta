import React from 'react';
import { PriceBreakdown } from './types';

export interface BottomPriceSummaryProps {
  breakdown: PriceBreakdown;
  onConfirm: () => void;
  onCancel?: () => void;
  confirmLabel?: string;
  showBreakdown?: boolean;
  loading?: boolean;
}

export const BottomPriceSummary: React.FC<BottomPriceSummaryProps> = ({
  breakdown,
  onConfirm,
  onCancel,
  confirmLabel = 'Randevuyu Onayla',
  showBreakdown = true,
  loading = false,
}) => {
  return (
    <div className="fixed bottom-0 left-0 right-0 bg-white border-t border-gray-200 shadow-2xl">
      {/* Content Container */}
      <div className="max-w-2xl mx-auto px-4 py-4">
        {/* Breakdown Details */}
        {showBreakdown && (
          <div className="mb-4 space-y-2 text-sm">
            {breakdown.discount && breakdown.discount > 0 && (
              <div className="flex justify-between text-gray-600">
                <span>İndirim</span>
                <span className="text-green-600 font-medium">
                  -{breakdown.discount.toLocaleString('tr-TR')} TL
                </span>
              </div>
            )}
            {breakdown.tax && breakdown.tax > 0 && (
              <div className="flex justify-between text-gray-600">
                <span>Vergi</span>
                <span>{breakdown.tax.toLocaleString('tr-TR')} TL</span>
              </div>
            )}
          </div>
        )}

        {/* Total Amount */}
        <div className="mb-4 p-4 bg-gray-50 rounded-lg">
          <div className="flex justify-between items-baseline">
            <span className="text-gray-700 font-semibold">Toplam</span>
            <span className="text-3xl font-bold text-amber-600">
              {breakdown.total.toLocaleString('tr-TR')} TL
            </span>
          </div>
        </div>

        {/* Action Buttons */}
        <div className="flex gap-3 pb-2">
          {onCancel && (
            <button
              onClick={onCancel}
              disabled={loading}
              className="flex-1 py-4 px-4 border border-gray-300 rounded-lg font-semibold text-gray-700 hover:bg-gray-50 transition-all duration-200 disabled:opacity-50"
            >
              İptal
            </button>
          )}
          <button
            onClick={onConfirm}
            disabled={loading}
            className={`flex-1 py-4 px-4 rounded-lg font-semibold text-white transition-all duration-200 ${
              loading
                ? 'bg-amber-500 opacity-75'
                : 'bg-amber-600 hover:bg-amber-700 active:bg-amber-800'
            } disabled:cursor-not-allowed`}
            aria-busy={loading}
          >
            {loading ? (
              <span className="flex items-center justify-center gap-2">
                <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                İşleniyor...
              </span>
            ) : (
              confirmLabel
            )}
          </button>
        </div>
      </div>
    </div>
  );
};
