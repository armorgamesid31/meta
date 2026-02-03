import { Search } from 'lucide-react';

interface SearchBarProps {
  value: string;
  onChange: (value: string) => void;
}

export function SearchBar({ value, onChange }: SearchBarProps) {
  return (
    <div className="relative">
      <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
      <input
        type="text"
        placeholder="Hizmet ara..."
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full bg-white rounded-[12px] pl-10 pr-3 py-2 text-[12px] text-[#2D2D2D] placeholder:text-[#9CA3AF] border border-gray-100 focus:outline-none focus:ring-2 focus:ring-[#BC952B]/20 shadow-sm transition-all"
      />
    </div>
  );
}
