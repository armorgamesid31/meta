import { X, Check } from 'lucide-react';
import type { Service } from './ServiceList.js';

interface PriceBreakdownModalProps {
  isOpen: boolean;
  onClose: () => void;
  services: Service[];
  referralDiscount: number;
  subtotal: number;
  finalPrice: number;
}

export function PriceBreakdownModal({
  isOpen,
  onClose,
  services,
  referralDiscount,
  subtotal,
  finalPrice
}: PriceBreakdownModalProps) {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
      <div className="bg-white rounded-2xl max-w-sm w-full max-h-[80vh] overflow-hidden shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-gray-100">
          <h3 className="text-lg font-semibold text-[#2D2D2D]">Fiyat Detayı</h3>
          <button
            onClick={onClose}
            className="w-8 h-8 flex items-center justify-center rounded-full hover:bg-gray-100 transition-colors"
          >
            <X className="w-5 h-5 text-gray-500" />
          </button>
        </div>

        {/* Content */}
        <div className="p-6 space-y-4 max-h-96 overflow-y-auto">
          {/* Services */}
          <div className="space-y-3">
            <h4 className="font-medium text-[#2D2D2D] text-sm">Seçilen Hizmetler</h4>
            {services.map((service) => (
              <div key={service.id} className="flex items-center justify-between py-2">
                <div className="flex-1">
                  <p className="text-sm font-medium text-[#2D2D2D]">{service.name}</p>
                  <p className="text-xs text-gray-500">{service.duration}dk</p>
                  {service.forGuest && (
                    <span className="text-xs bg-blue-100 text-blue-700 px-2 py-0.5 rounded-full">
                      Misafir için
                    </span>
                  )}
                </div>
                <div className="text-right">
                  <p className="text-sm font-semibold text-[#2D2D2D]">{service.price}₺</p>
                </div>
              </div>
            ))}
          </div>

          {/* Subtotal */}
          <div className="border-t border-gray-100 pt-4">
            <div className="flex items-center justify-between">
              <span className="text-sm text-gray-600">Ara Toplam</span>
              <span className="text-sm font-medium text-[#2D2D2D]">{subtotal}₺</span>
            </div>
          </div>

          {/* Referral Discount */}
          {referralDiscount > 0 && (
            <div className="flex items-center justify-between text-green-600">
              <div className="flex items-center gap-2">
                <Check className="w-4 h-4" />
                <span className="text-sm font-medium">Referans İndirimi</span>
              </div>
              <span className="text-sm font-medium">-{referralDiscount}₺</span>
            </div>
          )}

          {/* Final Total */}
          <div className="border-t border-gray-200 pt-4">
            <div className="flex items-center justify-between">
              <span className="text-lg font-bold text-[#2D2D2D]">Toplam</span>
              <span className="text-lg font-bold text-[#D4AF37]">{finalPrice}₺</span>
            </div>
          </div>

          {/* Additional Info */}
          <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 mt-4">
            <p className="text-xs text-blue-800 leading-relaxed">
              <strong>Önemli:</strong> Fiyatlar hizmet sağlayıcınızın belirlediği fiyatlardır.
              Ek masaj, bakım veya özel istekler için ekstra ücret uygulanabilir.
            </p>
          </div>
        </div>

        {/* Footer */}
        <div className="border-t border-gray-100 p-6">
          <button
            onClick={onClose}
            className="w-full bg-[#D4AF37] text-white font-semibold py-3 px-6 rounded-xl hover:bg-[#B8941F] transition-colors"
          >
            Anladım
          </button>
        </div>
      </div>
    </div>
  );
}