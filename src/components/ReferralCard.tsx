import { useState } from 'react';
import { Gift, Phone, Users } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

interface ReferralCardProps {
  onToggle: (active: boolean, phone: string) => void;
  active: boolean;
}

export function ReferralCard({ onToggle, active }: ReferralCardProps) {
  const [phone, setPhone] = useState('');

  const handleToggle = () => {
    const newActive = !active;
    onToggle(newActive, newActive ? phone : '');
  };

  const handlePhoneChange = (value: string) => {
    // Only allow numbers and limit to 10 digits
    const cleaned = value.replace(/\D/g, '').slice(0, 10);
    setPhone(cleaned);
    onToggle(active, cleaned);
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: -10 }}
      animate={{ opacity: 1, y: 0 }}
      className="bg-gradient-to-br from-[#D4AF37]/10 via-white to-[#D4AF37]/5 rounded-[20px] border-2 border-[#D4AF37] p-4 shadow-md"
    >
      <div className="flex items-start justify-between gap-3 mb-3">
        <div className="flex items-start gap-3 flex-1">
          <div className="w-12 h-12 bg-[#D4AF37] rounded-full flex items-center justify-center flex-shrink-0">
            <Users className="w-6 h-6 text-white" />
          </div>
          <div>
            <h3 className="font-semibold text-[#2D2D2D] mb-1">
              Randevuna arkadaşını ekle, anında 100 TL kazan!
            </h3>
            <p className="text-sm text-gray-600">
              Hem sen hem de arkadaşın indirim kazanın
            </p>
          </div>
        </div>

        {/* Toggle Switch */}
        <button
          onClick={handleToggle}
          className={`relative w-14 h-7 rounded-full transition-colors flex-shrink-0 ${
            active ? 'bg-[#10B981]' : 'bg-gray-300'
          }`}
          aria-label="Kampanyayı aktif et"
        >
          <motion.div
            className="absolute top-1 w-5 h-5 bg-white rounded-full shadow-md"
            animate={{
              left: active ? '30px' : '4px',
            }}
            transition={{
              type: 'spring',
              stiffness: 500,
              damping: 30,
            }}
          />
        </button>
      </div>

      {/* Phone Input - Animated */}
      <AnimatePresence>
        {active && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.2 }}
          >
            <div className="relative mt-3">
              <Phone className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
              <input
                type="tel"
                placeholder="Arkadaşının Telefon Numarası"
                value={phone}
                onChange={(e) => handlePhoneChange(e.target.value)}
                className="w-full bg-white rounded-[15px] pl-11 pr-4 py-3 text-[#2D2D2D] placeholder:text-gray-400 border border-[#D4AF37]/30 focus:outline-none focus:ring-2 focus:ring-[#D4AF37]/50"
                maxLength={10}
              />
              {phone.length > 0 && (
                <div className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-gray-500">
                  {phone.length}/10
                </div>
              )}
            </div>
            {phone.length === 10 && (
              <motion.p
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                className="text-xs text-[#10B981] mt-2 flex items-center gap-1"
              >
                ✓ 100 TL indirim tüm hizmetlere uygulanacak
              </motion.p>
            )}
          </motion.div>
        )}
      </AnimatePresence>

      {/* Live Price Preview */}
      {active && phone.length === 10 && (
        <motion.div
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          className="mt-3 bg-[#10B981]/10 rounded-[15px] px-3 py-2 flex items-center justify-center gap-2"
        >
          <Gift className="w-4 h-4 text-[#10B981]" />
          <p className="text-sm font-medium text-[#10B981]">
            Fiyatlar güncellendi! ⬇ 100 TL indirim
          </p>
        </motion.div>
      )}
    </motion.div>
  );
}
