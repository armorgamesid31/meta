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
    <div className="bg-white rounded-[12px] overflow-hidden shadow-sm border border-gray-100 mb-1.5 transition-all hover:shadow-md">
      {/* Category Header */}
      <button
        onClick={onToggle}
        className="w-full px-3 py-2.5 flex items-center justify-between hover:bg-[#FFF9E5]/15 transition-colors cursor-pointer"
      >
        <div className="flex items-center gap-2.5 flex-1 min-w-0">
          <div className="w-9 h-9 bg-[#FFF9E5] rounded-full flex items-center justify-center text-xl shadow-sm border border-[#BC952B]/15 flex-shrink-0">
            {icon}
          </div>
          <div className="flex items-center gap-1.5 flex-1 min-w-0">
            <span className="font-bold text-[#1a1a1a] text-[12px] leading-snug truncate">
              {categoryName}
            </span>
            {serviceCount > 0 && (
              <span className="text-[7px] font-bold bg-[#FEF3C7] text-[#D97706] px-1.5 py-0.5 rounded-sm border border-[#D97706]/20 flex-shrink-0">
                {serviceCount}
              </span>
            )}
          </div>
        </div>
        <ChevronDown
          className={`w-4 h-4 text-[#9ca3af] transition-transform duration-300 flex-shrink-0 ml-1.5 ${
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
