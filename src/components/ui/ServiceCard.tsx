import { useState } from 'react';
import { ChevronDown, Check, Package, User, Gift, Zap } from 'lucide-react';
import { Service, Staff } from './types.js';

interface ServiceCardProps {
  service: Service;
  isSelected: boolean;
  selectedStaffId?: string;
  staffOptions: Staff[];
  onToggle: () => void;
  onToggleGuest: () => void;
  onTogglePackage: () => void;
  onStaffSelect: (staffId: string) => void;
}

export function ServiceCard({
  service,
  isSelected,
  selectedStaffId,
  staffOptions,
  onToggle,
  onToggleGuest,
  onTogglePackage,
  onStaffSelect,
}: ServiceCardProps) {
  const [isStaffDropdownOpen, setIsStaffDropdownOpen] = useState(false);

  return (
    <div
      className={`border-b border-gray-100 last:border-b-0 transition-colors ${
        isSelected ? 'bg-[#FFFBF0] border-l-[4px] border-l-[#BC952B]' : 'bg-white'
      }`}
    >
      <div className="px-2 py-1">
        {/* Main Service Row */}
        <div className="flex items-center justify-between gap-1.5">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-1 mb-0 flex-wrap">
               <h4 className="font-bold text-[#1a1a1a] text-[12px] leading-tight">
                {service.name}
              </h4>
              {service.hasSynergy && (
                <span className="text-[8px] bg-[#FEF3C7] text-[#D97706] px-1 py-0 rounded-md flex items-center gap-0.5 font-bold uppercase tracking-tight border border-[#D97706]/10 shadow-sm">
                  <Zap className="w-2 h-2 fill-current" />
                  {service.synergyBadge}
                </span>
              )}
            </div>
          </div>

          <div className="flex items-center gap-1">
            {/* Price */}
            <div className="text-right flex flex-col items-end justify-center min-w-[50px]">
              {service.usePackage ? (
                <p className="font-bold text-[#10B981] text-[10px]">Ücretsiz</p>
              ) : service.discountedPrice ? (
                <>
                  <p className="text-[8px] text-[#9ca3af] line-through font-bold leading-none">
                    {service.price} TL
                  </p>
                  <p className="font-black text-[#10B981] text-[11px] leading-none">
                    {service.discountedPrice} TL
                  </p>
                </>
              ) : (
                <p className="font-black text-[#1a1a1a] text-[11px]">
                  {service.price} TL
                </p>
              )}
            </div>

            {/* Add/Added Button */}
            <button
              onClick={onToggle}
              className={`min-w-[65px] h-[24px] rounded-[6px] font-bold text-[10px] transition-all flex items-center justify-center gap-0 shadow-sm cursor-pointer ${
                isSelected
                  ? 'bg-[#BC952B] text-white shadow-md'
                  : 'bg-white border border-[#BC952B] text-[#BC952B] hover:bg-[#BC952B]/5 active:scale-95'
              }`}
            >
              {isSelected ? (
                <>
                  <Check className="w-2.5 h-2.5" strokeWidth={3.5} />
                  <span>Eklendi</span>
                </>
              ) : (
                <>
                  <span className="text-[9px]">+</span>
                  <span>Ekle</span>
                </>
              )}
            </button>
          </div>
        </div>

        {/* Configuration Row - Only shown when selected */}
        {isSelected && (
          <div className="mt-1 flex flex-wrap items-center gap-1 animate-in slide-in-from-top-2 fade-in duration-300">
            {/* Staff Selector Chip */}
            <div className="relative">
              <button
                onClick={() => setIsStaffDropdownOpen(!isStaffDropdownOpen)}
                className="h-[22px] px-1.5 bg-white border border-gray-200 rounded-md text-[8px] flex items-center gap-0.5 hover:border-[#BC952B] transition-colors cursor-pointer text-[#374151] font-bold shadow-sm"
              >
                <User className="w-3.5 h-3.5 text-[#BC952B]" />
                <span>
                  Çalışan:{' '}
                  <span className="text-[#1a1a1a]">
                    {staffOptions.find((s) => s.id === selectedStaffId)?.name ||
                      'Zeynep'}
                  </span>
                </span>
                <ChevronDown className={`w-3.5 h-3.5 text-gray-400 transition-transform ${isStaffDropdownOpen ? 'rotate-180' : ''}`} />
              </button>

              {/* Staff Dropdown */}
              {isStaffDropdownOpen && (
                <div className="absolute top-full left-0 mt-1.5 bg-white rounded-2xl shadow-xl border border-gray-100 py-1.5 z-10 min-w-[180px] animate-in zoom-in-95 duration-200">
                  {staffOptions.map((staff) => (
                    <button
                      key={staff.id}
                      onClick={() => {
                        onStaffSelect(staff.id);
                        setIsStaffDropdownOpen(false);
                      }}
                      className={`w-full px-4 py-2.5 text-left hover:bg-[#FFF9E5] flex items-center gap-3 cursor-pointer transition-colors ${
                        selectedStaffId === staff.id ? 'bg-[#FFF9E5]' : ''
                      }`}
                    >
                      <span className="text-xl">{staff.emoji}</span>
                      <span className="text-xs font-bold text-[#374151]">
                        {staff.name}
                      </span>
                      {selectedStaffId === staff.id && (
                        <Check className="w-4 h-4 text-[#BC952B] ml-auto" strokeWidth={3} />
                      )}
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Guest Selector Chip */}
            <button
              onClick={onToggleGuest}
              className={`h-[22px] px-1.5 rounded-md text-[8px] flex items-center gap-0.5 transition-all cursor-pointer font-bold border shadow-sm ${
                service.forGuest
                  ? 'bg-[#BC952B] text-white border-[#BC952B]'
                  : 'bg-white border-gray-200 text-[#4b5563] hover:border-[#BC952B]'
              }`}
            >
              {service.forGuest ? (
                <>
                  <Gift className="w-3.5 h-3.5" />
                  <span>Misafir</span>
                </>
              ) : (
                <>
                  <User className="w-3.5 h-3.5 text-gray-400" />
                  <span>Bana</span>
                </>
              )}
            </button>

            {/* Package Chip - Only if package available */}
            {service.packageAvailable && (
              <button
                onClick={onTogglePackage}
                className={`h-[22px] px-1.5 rounded-md text-[8px] flex items-center gap-0.5 transition-all cursor-pointer font-bold border shadow-sm ${
                  service.usePackage
                    ? 'bg-[#10B981] text-white border-[#10B981]'
                    : 'bg-[#ECFDF5] text-[#059669] border-[#059669]/20 hover:bg-[#d1fae5]'
                }`}
              >
                <Package className="w-2.5 h-2.5" />
                <span>Paket</span>
                <span className="bg-white/20 px-0.5 rounded text-[7px]">
                  {service.packageSessionsLeft}
                </span>
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
