import React from 'react';
import { Loader2, X } from 'lucide-react';
import { PriceBreakdown } from './types';

export interface BottomPriceSummaryProps {
  breakdown: PriceBreakdown;
  onConfirm: () => void;
  onCancel?: () => void;
  confirmLabel?: string;
  cancelLabel?: string;
  showBreakdown?: boolean;
  loading?: boolean;
  sticky?: boolean;
}

export const BottomPriceSummary: React.FC<BottomPriceSummaryProps> = ({
  breakdown,
  onConfirm,
  onCancel,
  confirmLabel = 'Randevuyu Onayla',
  cancelLabel = 'İptal',
  showBreakdown = true,
  loading = false,
  sticky = true,
}) => {
  const containerClass = sticky
    ? 'fixed bottom-0 left-0 right-0'
    : 'relative w-full';

  return (
    <div
      className={`${containerClass} bg-white border-t border-gray-200 shadow-2xl`}
    >
      {/* Content Container */}
      <div className="max-w-2xl mx-auto px-4 py-4">
        {/* Breakdown Details */}
        {showBreakdown && (
          <div className="mb-4 space-y-2 text-sm">
            {breakdown.subtotal && breakdown.subtotal > 0 && (
              <div className="flex justify-between text-gray-600">
                <span>Toplam Hizmet</span>
                <span className="font-medium">
                  {breakdown.subtotal.toLocaleString('tr-TR')} TL
                </span>
              </div>
            )}
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
        <div className="mb-4 p-4 bg-amber-50 rounded-lg border border-amber-200">
          <div className="flex justify-between items-baseline gap-2">
            <span className="text-gray-700 font-semibold text-sm">Toplam</span>
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
              className="flex-1 py-4 px-4 border-2 border-gray-300 rounded-lg font-semibold text-gray-700 hover:bg-gray-50 hover:border-gray-400 transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
            >
              {!loading && <X className="w-4 h-4" />}
              {cancelLabel}
            </button>
          )}
          <button
            onClick={onConfirm}
            disabled={loading}
            className={`flex-1 py-4 px-4 rounded-lg font-semibold text-white transition-all duration-200 flex items-center justify-center gap-2 ${
              loading
                ? 'bg-amber-500 opacity-75'
                : 'bg-amber-600 hover:bg-amber-700 active:bg-amber-800 shadow-md'
            } disabled:cursor-not-allowed`}
            aria-busy={loading}
          >
            {loading && <Loader2 className="w-4 h-4 animate-spin" />}
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
};
