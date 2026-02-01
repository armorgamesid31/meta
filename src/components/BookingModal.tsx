import { X, Check, Clock, User, Phone } from 'lucide-react';
import type { Service } from './ServiceList.js';

interface Booking {
  services: Service[];
  date?: string;
  time?: string;
  referralPhone?: string;
  referralActive: boolean;
  selectedStaff?: string;
}

interface BookingModalProps {
  isOpen: boolean;
  onClose: () => void;
  booking: Booking;
}

export function BookingModal({ isOpen, onClose, booking }: BookingModalProps) {
  if (!isOpen) return null;

  const formatDateTime = (date: string, time: string) => {
    const dateObj = new Date(date);
    const [hours, minutes] = time.split(':');
    dateObj.setHours(parseInt(hours), parseInt(minutes));

    return dateObj.toLocaleString('tr-TR', {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  const totalDuration = booking.services.reduce((sum, service) => sum + service.duration, 0);
  const totalPrice = booking.services.reduce((sum, service) => sum + service.price, 0);
  const finalPrice = booking.referralActive && booking.referralPhone ? totalPrice - 100 : totalPrice;

  const handleConfirm = () => {
    // Here we would integrate with the actual booking API
    console.log('Booking confirmed:', booking);
    // For now, just close the modal
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
      <div className="bg-white rounded-2xl max-w-sm w-full max-h-[90vh] overflow-hidden shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-gray-100">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-green-100 rounded-full flex items-center justify-center">
              <Check className="w-6 h-6 text-green-600" />
            </div>
            <div>
              <h3 className="text-lg font-semibold text-[#2D2D2D]">Randevu Onayı</h3>
              <p className="text-sm text-gray-600">Lütfen bilgileri kontrol edin</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 flex items-center justify-center rounded-full hover:bg-gray-100 transition-colors"
          >
            <X className="w-5 h-5 text-gray-500" />
          </button>
        </div>

        {/* Content */}
        <div className="p-6 space-y-6 max-h-96 overflow-y-auto">
          {/* Date & Time */}
          <div className="bg-blue-50 border border-blue-200 rounded-xl p-4">
            <div className="flex items-center gap-3 mb-2">
              <Clock className="w-5 h-5 text-blue-600" />
              <span className="font-medium text-blue-900">Randevu Zamanı</span>
            </div>
            <p className="text-blue-800">
              {booking.date && booking.time && formatDateTime(booking.date, booking.time)}
            </p>
            <p className="text-sm text-blue-600 mt-1">
              Tahmini süre: {totalDuration} dakika
            </p>
          </div>

          {/* Services */}
          <div>
            <h4 className="font-medium text-[#2D2D2D] mb-3">Seçilen Hizmetler</h4>
            <div className="space-y-3">
              {booking.services.map((service) => (
                <div key={service.id} className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
                  <div className="flex-1">
                    <p className="font-medium text-[#2D2D2D]">{service.name}</p>
                    <div className="flex items-center gap-2 mt-1">
                      <span className="text-sm text-gray-600">{service.duration}dk</span>
                      {service.forGuest && (
                        <span className="text-xs bg-blue-100 text-blue-700 px-2 py-0.5 rounded-full">
                          Misafir için
                        </span>
                      )}
                    </div>
                  </div>
                  <span className="font-semibold text-[#2D2D2D]">{service.price}₺</span>
                </div>
              ))}
            </div>
          </div>

          {/* Staff Selection */}
          {booking.selectedStaff && (
            <div className="flex items-center gap-3 p-3 bg-gray-50 rounded-lg">
              <User className="w-5 h-5 text-gray-600" />
              <div>
                <p className="text-sm text-gray-600">Tercih Edilen Uzman</p>
                <p className="font-medium text-[#2D2D2D]">
                  {booking.selectedStaff === 'any' ? 'Fark Etmez' : booking.selectedStaff}
                </p>
              </div>
            </div>
          )}

          {/* Referral */}
          {booking.referralActive && booking.referralPhone && (
            <div className="flex items-center gap-3 p-3 bg-green-50 border border-green-200 rounded-lg">
              <Phone className="w-5 h-5 text-green-600" />
              <div>
                <p className="text-sm text-green-600">Referans Numarası</p>
                <p className="font-medium text-green-800">{booking.referralPhone}</p>
                <p className="text-xs text-green-600">100₺ indirim uygulandı</p>
              </div>
            </div>
          )}

          {/* Price Summary */}
          <div className="border-t border-gray-200 pt-4">
            <div className="flex items-center justify-between mb-2">
              <span className="text-gray-600">Ara Toplam</span>
              <span className="font-medium text-[#2D2D2D]">{totalPrice}₺</span>
            </div>
            {booking.referralActive && (
              <div className="flex items-center justify-between text-green-600 mb-2">
                <span>Referans İndirimi</span>
                <span>-100₺</span>
              </div>
            )}
            <div className="flex items-center justify-between text-lg font-bold">
              <span className="text-[#2D2D2D]">Toplam</span>
              <span className="text-[#D4AF37]">{finalPrice}₺</span>
            </div>
          </div>

          {/* Terms */}
          <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-3">
            <p className="text-xs text-yellow-800 leading-relaxed">
              Randevuyu onaylayarak, salonun iptal ve değişiklik politikalarını kabul etmiş olursunuz.
              İptal durumunda ücret iadesi salon politikasına göre yapılır.
            </p>
          </div>
        </div>

        {/* Footer */}
        <div className="border-t border-gray-100 p-6 space-y-3">
          <button
            onClick={handleConfirm}
            className="w-full bg-gradient-to-r from-[#D4AF37] to-[#F4D03F] text-white font-bold py-4 px-6 rounded-xl hover:from-[#B8941F] hover:to-[#E6C84A] transition-all shadow-lg"
          >
            Randevuyu Onayla
          </button>
          <button
            onClick={onClose}
            className="w-full text-gray-600 font-medium py-2 px-6 rounded-xl hover:bg-gray-100 transition-colors"
          >
            İptal
          </button>
        </div>
      </div>
    </div>
  );
}