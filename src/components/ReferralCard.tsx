import { useState } from 'react';
import { Gift, ChevronDown, ChevronUp, Check } from 'lucide-react';

interface ReferralCardProps {
  onToggle: (active: boolean, phone: string) => void;
  active: boolean;
}

export function ReferralCard({ onToggle, active }: ReferralCardProps) {
  const [phone, setPhone] = useState('');
  const [isExpanded, setIsExpanded] = useState(false);

  const handleToggle = () => {
    if (active) {
      // Deactivate
      onToggle(false, '');
      setPhone('');
      setIsExpanded(false);
    } else {
      // Activate
      if (phone.length === 10) {
        onToggle(true, phone);
        setIsExpanded(false);
      } else {
        setIsExpanded(true);
      }
    }
  };

  const isValidPhone = phone.length === 10 && phone.startsWith('5');

  return (
    <div className="bg-gradient-to-r from-[#D4AF37]/10 to-[#F4D03F]/10 rounded-[20px] p-4 border border-[#D4AF37]/20">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-gradient-to-br from-[#D4AF37] to-[#F4D03F] rounded-xl flex items-center justify-center">
            <Gift className="w-5 h-5 text-white" />
          </div>
          <div>
            <h3 className="font-semibold text-[#2D2D2D]">Referans İndirimi</h3>
            <p className="text-sm text-gray-600">
              {active ? 'Aktif - 100₺ indirim' : 'Arkadaşını referans göster, 100₺ kazan'}
            </p>
          </div>
        </div>

        <button
          onClick={() => setIsExpanded(!isExpanded)}
          className={`w-10 h-10 rounded-full flex items-center justify-center transition-all ${
            active
              ? 'bg-[#D4AF37] text-white'
              : 'bg-white border-2 border-[#D4AF37] text-[#D4AF37]'
          }`}
        >
          {active ? (
            <Check className="w-5 h-5" />
          ) : isExpanded ? (
            <ChevronUp className="w-5 h-5" />
          ) : (
            <ChevronDown className="w-5 h-5" />
          )}
        </button>
      </div>

      {/* Expanded Phone Input */}
      {isExpanded && !active && (
        <div className="mt-4 pt-4 border-t border-[#D4AF37]/20">
          <div className="space-y-3">
            <div>
              <label className="block text-sm font-medium text-[#2D2D2D] mb-2">
                Referans Telefon Numarası
              </label>
              <input
                type="tel"
                placeholder="0555 123 45 67"
                value={phone}
                onChange={(e) => setPhone(e.target.value.replace(/\D/g, '').slice(0, 10))}
                className="w-full px-4 py-3 bg-white rounded-xl border border-gray-200 focus:ring-2 focus:ring-[#D4AF37]/30 focus:border-[#D4AF37] text-[#2D2D2D] placeholder:text-gray-400"
              />
              <p className="text-xs text-gray-500 mt-1">
                Referans gösterdiğin kişinin telefon numarası
              </p>
            </div>

            <button
              onClick={handleToggle}
              disabled={!isValidPhone}
              className={`w-full py-3 rounded-xl font-medium transition-all ${
                isValidPhone
                  ? 'bg-[#D4AF37] text-white hover:bg-[#B8941F] shadow-sm'
                  : 'bg-gray-200 text-gray-400 cursor-not-allowed'
              }`}
            >
              {isValidPhone ? 'İndirimi Aktif Et' : 'Geçerli telefon numarası girin'}
            </button>
          </div>
        </div>
      )}

      {/* Active State Info */}
      {active && (
        <div className="mt-4 pt-4 border-t border-[#D4AF37]/20">
          <div className="bg-green-50 border border-green-200 rounded-lg p-3">
            <div className="flex items-center gap-2 text-green-800">
              <Check className="w-4 h-4" />
              <span className="text-sm font-medium">Referans indirimi aktif!</span>
            </div>
            <p className="text-xs text-green-600 mt-1">
              Toplam tutardan 100₺ indirim uygulanacak.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}