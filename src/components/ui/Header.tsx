import { Sparkles } from 'lucide-react';

interface HeaderProps {
  customerName: string;
  selectedGender?: 'woman' | 'man';
  onGenderClick?: () => void;
}

export function Header({ customerName, selectedGender, onGenderClick }: HeaderProps) {
  return (
    <header className="bg-white">
      <div className="max-w-md mx-auto px-4 py-4">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 bg-[#D4AF37] rounded-xl flex items-center justify-center rotate-45 shadow-sm">
              <Sparkles className="w-5 h-5 text-white -rotate-45" />
            </div>
            <h1 className="text-xl font-bold text-[#2D2D2D]">SalonAsistan</h1>
          </div>

          {selectedGender && onGenderClick && (
            <button
              onClick={onGenderClick}
              className="w-10 h-10 bg-[#FFF8E1] rounded-full flex items-center justify-center text-xl border border-[#D4AF37]/20 shadow-sm cursor-pointer"
              aria-label="Cinsiyet seçimi"
            >
              {selectedGender === 'woman' ? '👩' : '👨'}
            </button>
          )}
        </div>

        <p className="text-[#4B5563] text-sm font-medium">
          Tekrar hoş geldin, <span className="text-[#2D2D2D] font-bold">{customerName}</span> ✨
        </p>
      </div>
    </header>
  );
}
