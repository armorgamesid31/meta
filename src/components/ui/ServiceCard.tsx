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
      className={`border-b border-gray-100 last:border-b-0 transition-all ${
        isSelected ? 'bg-[#FFFDF5] border-l-[4px] border-l-[#BC952B]' : 'bg-white'
      }`}
    >
      <div className="px-5 py-4">
        {/* Main Service Row */}
        <div className="flex items-start justify-between gap-3">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1.5 flex-wrap">
               <h4 className="font-bold text-[#1a1a1a] text-[15px] leading-tight">
                {service.name}
              </h4>
              {service.hasSynergy && (
                <span className="text-[9px] bg-[#FEF3C7] text-[#D97706] px-1.5 py-0.5 rounded-lg flex items-center gap-1 font-bold uppercase tracking-wider border border-[#D97706]/10 shadow-sm">
                  <Zap className="w-2.5 h-2.5 fill-current" />
                  {service.synergyBadge}
                </span>
              )}
            </div>
            
            <div className="flex items-center gap-3">
              <span className="text-xs text-[#6b7280] font-bold">
                {service.duration}
              </span>

              {service.packageAvailable && !service.hasSynergy && (
                <span className="text-[10px] bg-[#ECFDF5] text-[#059669] px-2 py-0.5 rounded-lg flex items-center gap-1 font-bold border border-[#059669]/10">
                  <Package className="w-2.5 h-2.5" />
                  Paket var
                </span>
              )}
            </div>
          </div>

          <div className="flex items-center gap-3">
            {/* Price */}
            <div className="text-right flex flex-col items-end justify-center min-w-[70px]">
              {service.usePackage ? (
                <p className="font-bold text-[#10B981] text-sm">Ücretsiz</p>
              ) : service.discountedPrice ? (
                <>
                  <p className="text-[11px] text-[#9ca3af] line-through font-bold leading-none mb-1">
                    {service.price} TL
                  </p>
                  <p className="font-black text-[#10B981] text-[16px] leading-none">
                    {service.discountedPrice} TL
                  </p>
                </>
              ) : (
                <p className="font-black text-[#1a1a1a] text-[16px]">
                  {service.price} TL
                </p>
              )}
            </div>

            {/* Add/Added Button */}
            <button
              onClick={onToggle}
              className={`min-w-[84px] h-[34px] rounded-xl font-bold text-xs transition-all flex items-center justify-center gap-1 shadow-sm cursor-pointer ${
                isSelected
                  ? 'bg-[#BC952B] text-white'
                  : 'bg-white border-2 border-[#BC952B] text-[#BC952B] hover:bg-[#BC952B]/5'
              }`}
            >
              {isSelected ? (
                <>
                  <Check className="w-3.5 h-3.5" strokeWidth={3.5} />
                  <span>Eklendi</span>
                </>
              ) : (
                <>
                  <span className="text-sm">+</span>
                  <span>Ekle</span>
                </>
              )}
            </button>
          </div>
        </div>

        {/* Configuration Row - Only shown when selected */}
        {isSelected && (
          <div className="mt-5 flex flex-wrap items-center gap-2 animate-in slide-in-from-top-2 fade-in duration-300">
            {/* Staff Selector Chip */}
            <div className="relative">
              <button
                onClick={() => setIsStaffDropdownOpen(!isStaffDropdownOpen)}
                className="h-[34px] px-3 bg-white border border-gray-200 rounded-2xl text-[12px] flex items-center gap-2 hover:border-[#BC952B] transition-colors cursor-pointer text-[#374151] font-bold shadow-sm"
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
              className={`h-[34px] px-4 rounded-2xl text-[12px] flex items-center gap-2 transition-all cursor-pointer font-bold border shadow-sm ${
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
                className={`h-[34px] px-4 rounded-2xl text-[11px] flex items-center gap-2 transition-all cursor-pointer font-bold border shadow-sm ${
                  service.usePackage
                    ? 'bg-[#10B981] text-white border-[#10B981]'
                    : 'bg-[#ECFDF5] text-[#059669] border-[#059669]/20 hover:bg-[#d1fae5]'
                }`}
              >
                <Package className="w-4 h-4" />
                <span>Paketimi Kullan</span>
                <span className="bg-white/20 px-1.5 rounded-lg text-[10px]">
                  {service.packageSessionsLeft} kaldı
                </span>
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
