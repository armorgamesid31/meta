import { motion, AnimatePresence } from 'framer-motion';

interface WelcomeModalProps {
  isOpen: boolean;
  onSelectGender: (gender: 'woman' | 'man') => void;
}

export function WelcomeModal({ isOpen, onSelectGender }: WelcomeModalProps) {
  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
        >
          <motion.div
            initial={{ scale: 0.9, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0.9, opacity: 0 }}
            className="bg-white/95 backdrop-blur-md rounded-3xl p-8 max-w-sm w-full mx-4 shadow-2xl border border-gray-200"
          >
            <div className="text-center">
              <div className="w-16 h-16 bg-gradient-to-br from-[#D4AF37] to-[#F4D03F] rounded-full flex items-center justify-center mx-auto mb-6">
                <span className="text-2xl">✨</span>
              </div>

              <h2 className="text-2xl font-bold text-[#2D2D2D] mb-2">
                SalonAsistan'a Hoş Geldiniz
              </h2>
              <p className="text-gray-600 mb-8 leading-relaxed">
                Size en uygun hizmetleri sunabilmek için lütfen tercih ettiğiniz kategoriyi seçin
              </p>

              <div className="space-y-4">
                <motion.button
                  whileHover={{ scale: 1.02 }}
                  whileTap={{ scale: 0.98 }}
                  onClick={() => onSelectGender('woman')}
                  className="w-full bg-gradient-to-r from-pink-100 to-pink-200 hover:from-pink-200 hover:to-pink-300 text-pink-800 font-semibold py-4 px-6 rounded-2xl border border-pink-300 transition-all duration-200 shadow-lg"
                >
                  <div className="flex items-center justify-center gap-3">
                    <span className="text-3xl">👩</span>
                    <div className="text-left">
                      <div className="font-bold">Kadın Hizmetleri</div>
                      <div className="text-sm opacity-80">Epilasyon, bakım, makyaj...</div>
                    </div>
                  </div>
                </motion.button>

                <motion.button
                  whileHover={{ scale: 1.02 }}
                  whileTap={{ scale: 0.98 }}
                  onClick={() => onSelectGender('man')}
                  className="w-full bg-gradient-to-r from-blue-100 to-blue-200 hover:from-blue-200 hover:to-blue-300 text-blue-800 font-semibold py-4 px-6 rounded-2xl border border-blue-300 transition-all duration-200 shadow-lg"
                >
                  <div className="flex items-center justify-center gap-3">
                    <span className="text-3xl">👨</span>
                    <div className="text-left">
                      <div className="font-bold">Erkek Hizmetleri</div>
                      <div className="text-sm opacity-80">Saç kesimi, bakım...</div>
                    </div>
                  </div>
                </motion.button>
              </div>

              <p className="text-xs text-gray-500 mt-6">
                Seçiminizi daha sonra değiştirebilirsiniz
              </p>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}