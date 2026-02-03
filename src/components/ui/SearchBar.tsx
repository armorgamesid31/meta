import { Search } from 'lucide-react';

interface SearchBarProps {
  value: string;
  onChange: (value: string) => void;
}

export function SearchBar({ value, onChange }: SearchBarProps) {
  return (
    <div className="relative">
      <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
      <input
        type="text"
        placeholder="Hizmet ara..."
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full bg-white rounded-[18px] pl-12 pr-4 py-3 text-[13px] text-[#2D2D2D] placeholder:text-[#9CA3AF] border border-gray-100 focus:outline-none focus:ring-2 focus:ring-[#BC952B]/20 shadow-sm transition-all"
      />
    </div>
  );
}
