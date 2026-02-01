import { ChevronDown } from 'lucide-react';
import { ReactNode } from 'react';

interface ServiceAccordionProps {
  categoryName: string;
  icon: string;
  serviceCount: number;
  isOpen: boolean;
  onToggle: () => void;
  children: ReactNode;
}

export function ServiceAccordion({
  categoryName,
  icon,
  serviceCount,
  isOpen,
  onToggle,
  children,
}: ServiceAccordionProps) {
  return (
    <div className="bg-white rounded-[24px] overflow-hidden shadow-sm border border-gray-100 mb-3 transition-all">
      {/* Category Header */}
      <button
        onClick={onToggle}
        className="w-full px-5 py-4 flex items-center justify-between hover:bg-gray-50 transition-colors cursor-pointer"
      >
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-[#FFF9E5] rounded-full flex items-center justify-center text-xl shadow-sm border border-[#BC952B]/10">
            {icon}
          </div>
          <div className="flex items-center gap-2">
            <span className="font-bold text-[#1a1a1a] text-[15px]">
              {categoryName}
            </span>
            <span className="text-[10px] font-bold bg-[#F3F4F6] text-[#6B7280] px-2 py-0.5 rounded-full border border-gray-200 shadow-inner">
              {serviceCount}
            </span>
          </div>
        </div>
        <ChevronDown
          className={`w-5 h-5 text-[#9ca3af] transition-transform duration-300 ${
            isOpen ? 'rotate-180 text-[#BC952B]' : ''
          }`}
          strokeWidth={2.5}
        />
      </button>

      {/* Service Items */}
      {isOpen && (
        <div className="border-t border-gray-50 animate-in fade-in slide-in-from-top-2 duration-300">
          {children}
        </div>
      )}
    </div>
  );
}
