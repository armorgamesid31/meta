interface WelcomeModalProps {
  isOpen: boolean;
  onSelectGender: (gender: 'woman' | 'man') => void;
}

export function WelcomeModal({ isOpen, onSelectGender }: WelcomeModalProps) {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {/* Background Overlay */}
      <div className="absolute inset-0 bg-black/40 backdrop-blur-md" />

      {/* Modal Card */}
      <div className="relative bg-white rounded-[24px] shadow-2xl max-w-md w-full overflow-hidden animate-in zoom-in-95 duration-200">
        {/* Gold Accent Bar */}
        <div className="h-2 bg-gradient-to-r from-[#D4AF37] to-[#F4D03F]" />

        <div className="p-8">
          {/* Welcome Text */}
          <div className="text-center mb-8">
            <div className="w-20 h-20 bg-[#D4AF37]/10 rounded-full flex items-center justify-center mx-auto mb-4">
              <span className="text-4xl">✨</span>
            </div>
            <h2 className="text-2xl font-semibold text-[#2D2D2D] mb-2">
              Hoş Geldiniz!
            </h2>
            <p className="text-gray-600">
              Size özel fiyatlandırma ve hizmetleri görmek için lütfen bir
              kategori seçin:
            </p>
          </div>

          {/* Gender Cards */}
          <div className="space-y-3">
            <button
              onClick={() => onSelectGender('woman')}
              className="w-full bg-gradient-to-r from-[#D4AF37] to-[#F4D03F] text-white rounded-[20px] p-6 shadow-lg hover:shadow-xl transition-all hover:scale-[1.02] active:scale-[0.98] cursor-pointer"
            >
              <div className="flex items-center gap-4">
                <div className="w-16 h-16 bg-white/20 rounded-full flex items-center justify-center text-3xl">
                  👩
                </div>
                <div className="flex-1 text-left">
                  <p className="text-xl font-semibold">Kadın Menüsü</p>
                  <p className="text-sm text-white/90 mt-1">
                    Güzellik ve bakım hizmetleri
                  </p>
                </div>
              </div>
            </button>

            <button
              onClick={() => onSelectGender('man')}
              className="w-full bg-[#2D2D2D] text-white rounded-[20px] p-6 shadow-lg hover:shadow-xl transition-all hover:scale-[1.02] active:scale-[0.98] cursor-pointer"
            >
              <div className="flex items-center gap-4">
                <div className="w-16 h-16 bg-white/10 rounded-full flex items-center justify-center text-3xl">
                  👨
                </div>
                <div className="flex-1 text-left">
                  <p className="text-xl font-semibold">Erkek Menüsü</p>
                  <p className="text-sm text-white/80 mt-1">
                    Özel erkek bakım hizmetleri
                  </p>
                </div>
              </div>
            </button>
          </div>

          <p className="text-xs text-gray-500 text-center mt-6">
            Seçiminizi istediğiniz zaman değiştirebilirsiniz
          </p>
        </div>
      </div>
    </div>
  );
}
