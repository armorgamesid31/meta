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
    <div className="bg-white rounded-[18px] overflow-hidden shadow-sm border border-gray-100 mb-3 transition-all">
      {/* Category Header */}
      <button
        onClick={onToggle}
        className="w-full px-5 py-4 flex items-center justify-between hover:bg-[#FFF9E5]/30 transition-colors cursor-pointer"
      >
        <div className="flex items-center gap-3 flex-1">
          <div className="w-12 h-12 bg-[#FFF9E5] rounded-full flex items-center justify-center text-2xl shadow-sm border border-[#BC952B]/10 flex-shrink-0">
            {icon}
          </div>
          <div className="flex items-center gap-2 flex-1">
            <span className="font-bold text-[#1a1a1a] text-[14px] leading-tight">
              {categoryName}
            </span>
            <span className="text-[9px] font-bold bg-[#E5F4FF] text-[#0EA5E9] px-2 py-0.5 rounded-lg border border-[#0EA5E9]/20">
              {serviceCount}
            </span>
          </div>
        </div>
        <ChevronDown
          className={`w-5 h-5 text-[#9ca3af] transition-transform duration-300 flex-shrink-0 ${
            isOpen ? 'rotate-180 text-[#BC952B]' : ''
          }`}
          strokeWidth={2.5}
        />
      </button>

      {/* Service Items */}
      {isOpen && (
        <div className="border-t border-gray-50 bg-white animate-in fade-in slide-in-from-top-2 duration-300">
          {children}
        </div>
      )}
    </div>
  );
}
