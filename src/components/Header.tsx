import { Sparkles } from 'lucide-react';

interface HeaderProps {
  customerName: string;
  selectedGender?: 'FEMALE' | 'MALE';
  onGenderClick?: () => void;
}

export function Header({ customerName, selectedGender, onGenderClick }: HeaderProps) {
  return (
    <header className="bg-white border-b border-gray-100">
      <div className="max-w-md mx-auto px-4 py-6">
        <div className="flex items-center justify-between">
          {/* Logo + Title */}
          <div className="flex items-center gap-2">
            <div className="w-10 h-10 bg-gradient-to-br from-[#D4AF37] to-[#B8941F] rounded-2xl flex items-center justify-center">
              <Sparkles className="w-6 h-6 text-white" />
            </div>
            <h1 className="text-2xl font-semibold text-[#2D2D2D]">SalonAsistan</h1>
          </div>

          {/* Gender Indicator */}
          {selectedGender && onGenderClick && (
            <button
              onClick={onGenderClick}
              className="w-12 h-12 bg-[#D4AF37]/10 rounded-full flex items-center justify-center text-2xl hover:bg-[#D4AF37]/20 transition-all border-2 border-[#D4AF37]/30"
              aria-label="Cinsiyet seçimi"
            >
              {selectedGender === 'FEMALE' ? '👩' : '👨'}
            </button>
          )}
        </div>

        {/* Welcome Message */}
        <p className="text-[#2D2D2D] text-lg mt-4">
          Tekrar hoş geldin, <span className="font-medium">{customerName}</span> ✨
        </p>
      </div>
    </header>
  );
}