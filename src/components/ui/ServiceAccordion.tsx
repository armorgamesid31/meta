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
    <div className="bg-white rounded-[20px] overflow-hidden shadow-sm border border-gray-100">
      {/* Category Header */}
      <button
        onClick={onToggle}
        className="w-full px-4 py-4 flex items-center justify-between hover:bg-gray-50 transition-colors cursor-pointer"
      >
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 bg-[#D4AF37]/10 rounded-full flex items-center justify-center text-xl">
            {icon}
          </div>
          <span className="font-medium text-[#2D2D2D]">{categoryName}</span>
          <span className="text-xs bg-gray-100 text-gray-600 px-2 py-1 rounded-full">
            {serviceCount}
          </span>
        </div>
        <ChevronDown
          className={`w-5 h-5 text-gray-400 transition-transform duration-200 ${
            isOpen ? 'rotate-180' : ''
          }`}
        />
      </button>

      {/* Service Items */}
      {isOpen && <div className="border-t border-gray-100">{children}</div>}
    </div>
  );
}
