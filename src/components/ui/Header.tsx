import { Sparkles } from 'lucide-react';

interface HeaderProps {
  customerName: string;
  selectedGender?: 'woman' | 'man';
  onGenderClick?: () => void;
}

export function Header({ customerName, selectedGender, onGenderClick }: HeaderProps) {
  return (
    <header className="bg-white px-4 pt-6 pb-4">
      <div className="max-w-md mx-auto">
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-[#BC952B] rounded-xl flex items-center justify-center shadow-sm">
              <Sparkles className="w-6 h-6 text-white" />
            </div>
            <h1 className="text-xl font-bold text-[#1a1a1a] tracking-tight">SalonAsistan</h1>
          </div>

          {selectedGender && (
            <button
              onClick={onGenderClick}
              className="w-10 h-10 bg-[#FFF9E5] rounded-full flex items-center justify-center border border-[#BC952B]/20 shadow-sm cursor-pointer"
            >
              <img 
                src={selectedGender === 'woman' ? "https://api.dicebear.com/7.x/avataaars/svg?seed=Ayse" : "https://api.dicebear.com/7.x/avataaars/svg?seed=Ahmet"} 
                className="w-8 h-8 rounded-full"
                alt="Avatar"
              />
            </button>
          )}
        </div>

        <p className="text-[#374151] text-lg font-medium">
          Tekrar hoş geldin, <span className="font-bold text-[#1a1a1a]">{customerName}</span> <span className="inline-block animate-bounce">✨</span>
        </p>
      </div>
    </header>
  );
}
