interface WelcomeSelectorCardProps {
  onSelectGender: (gender: 'woman' | 'man') => void;
  primaryColor?: string;
  secondaryColor?: string;
  borderRadius?: string;
}

export function WelcomeSelectorCard({
  onSelectGender,
  primaryColor = '#BC952B',
  secondaryColor = '#2D2D2D',
  borderRadius = '20px',
}: WelcomeSelectorCardProps) {
  return (
    <div className="bg-white rounded-[24px] p-6 shadow-sm border border-gray-100 space-y-4">
      {/* Header */}
      <div className="text-center space-y-2 mb-2">
        <h2 className="text-xl font-bold text-[#1a1a1a]">Tekrar hoş geldiniz!</h2>
        <p className="text-[13px] text-[#6b7280] leading-relaxed">
          Size özel fiyatlandırma ve hizmetleri görmek için lütfen bir kategori seçin:
        </p>
      </div>

      {/* Gender Buttons */}
      <div className="space-y-3">
        <button
          onClick={() => onSelectGender('woman')}
          className="w-full p-4 rounded-[18px] text-white font-bold text-[15px] transition-all hover:shadow-lg active:scale-[0.98] cursor-pointer flex items-center gap-4 shadow-md"
          style={{
            backgroundColor: primaryColor,
            borderRadius,
          }}
        >
          <div className="w-14 h-14 bg-white/20 rounded-full flex items-center justify-center text-2xl flex-shrink-0">
            👩
          </div>
          <div className="flex-1 text-left">
            <p className="font-bold text-[15px]">Kadın Menüsü</p>
            <p className="text-xs text-white/85 mt-0.5">Güzellik hizmetleri</p>
          </div>
        </button>

        <button
          onClick={() => onSelectGender('man')}
          className="w-full p-4 rounded-[18px] text-white font-bold text-[15px] transition-all hover:shadow-lg active:scale-[0.98] cursor-pointer flex items-center gap-4 shadow-md"
          style={{
            backgroundColor: secondaryColor,
            borderRadius,
          }}
        >
          <div className="w-14 h-14 bg-white/10 rounded-full flex items-center justify-center text-2xl flex-shrink-0">
            👨
          </div>
          <div className="flex-1 text-left">
            <p className="font-bold text-[15px]">Erkek Menüsü</p>
            <p className="text-xs text-white/85 mt-0.5">Erkek bakım hizmetleri</p>
          </div>
        </button>
      </div>

      {/* Footer Note */}
      <p className="text-[11px] text-[#9ca3af] text-center font-medium mt-4">
        Seçiminizi istediğiniz zaman değiştirebilirsiniz
      </p>
    </div>
  );
}
