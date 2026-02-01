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
    <div className="bg-white rounded-[24px] overflow-hidden shadow-[0_2px_8px_rgba(0,0,0,0.04)] border border-gray-100 mb-3">
      {/* Category Header */}
      <button
        onClick={onToggle}
        className="w-full px-5 py-4 flex items-center justify-between hover:bg-gray-50 transition-colors cursor-pointer"
      >
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 bg-[#FFF7ED] rounded-full flex items-center justify-center text-lg text-[#FB923C]">
            {icon}
          </div>
          <div className="flex items-center gap-2">
            <span className="font-semibold text-[#2D2D2D] text-[15px]">
              {categoryName}
            </span>
            <span className="text-[11px] font-medium bg-[#F3F4F6] text-[#6B7280] px-2 py-0.5 rounded-full">
              {serviceCount}
            </span>
          </div>
        </div>
        <ChevronDown
          className={`w-5 h-5 text-gray-400 transition-transform duration-200 ${
            isOpen ? 'rotate-180' : ''
          }`}
        />
      </button>

      {/* Service Items */}
      {isOpen && <div className="border-t border-gray-50">{children}</div>}
    </div>
  );
}
