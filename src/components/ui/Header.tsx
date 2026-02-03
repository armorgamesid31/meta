import { Sparkles } from 'lucide-react';

interface HeaderProps {
  customerName: string;
  selectedGender?: 'woman' | 'man';
  onGenderClick?: () => void;
}

export function Header({ customerName, selectedGender, onGenderClick }: HeaderProps) {
  return (
    <header className="bg-white px-4 pt-5 pb-4">
      <div className="max-w-md mx-auto">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 bg-[#BC952B] rounded-lg flex items-center justify-center shadow-sm">
              <Sparkles className="w-5 h-5 text-white" />
            </div>
            <h1 className="text-lg font-bold text-[#1a1a1a] tracking-tight">SalonAsistan</h1>
          </div>

          {selectedGender && (
            <button
              onClick={onGenderClick}
              className="w-9 h-9 bg-[#FFF9E5] rounded-full flex items-center justify-center border border-[#BC952B]/20 shadow-sm cursor-pointer hover:shadow-md transition-all"
            >
              <img 
                src={selectedGender === 'woman' ? "https://api.dicebear.com/7.x/avataaars/svg?seed=Ayse" : "https://api.dicebear.com/7.x/avataaars/svg?seed=Ahmet"} 
                className="w-7 h-7 rounded-full"
                alt="Avatar"
              />
            </button>
          )}
        </div>

        <p className="text-[#374151] text-base font-medium">
          Tekrar hoş geldin, <span className="font-bold text-[#1a1a1a]">{customerName}</span> <span className="inline-block">✨</span>
        </p>
      </div>
    </header>
  );
}
