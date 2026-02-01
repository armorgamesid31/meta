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
      className={`border-b border-gray-50 last:border-b-0 transition-all ${
        isSelected ? 'bg-[#FFFBEB] border-l-[3px] border-l-[#F59E0B]' : 'bg-white'
      }`}
    >
      <div className="px-5 py-4">
        {/* Main Service Row */}
        <div className="flex items-start justify-between gap-3">
          <div className="flex-1 min-w-0">
            <h4 className="font-semibold text-[#1F2937] text-[15px] mb-1">
              {service.name}
            </h4>
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-xs text-gray-500 font-medium">
                {service.duration}
              </span>

              {service.hasSynergy && (
                <span className="text-[10px] bg-[#FEF3C7] text-[#D97706] px-1.5 py-0.5 rounded flex items-center gap-1 font-semibold">
                  <Zap className="w-3 h-3 fill-current" />
                  {service.synergyBadge}
                </span>
              )}

              {service.packageAvailable && !service.hasSynergy && (
                <span className="text-[10px] bg-[#ECFDF5] text-[#059669] px-1.5 py-0.5 rounded flex items-center gap-1 font-semibold">
                  <Package className="w-3 h-3" />
                  Paket var
                </span>
              )}
            </div>
          </div>

          <div className="flex items-center gap-3">
            {/* Price */}
            <div className="text-right flex flex-col items-end">
              {service.usePackage ? (
                <p className="font-semibold text-[#10B981] text-sm">Ücretsiz</p>
              ) : service.discountedPrice ? (
                <>
                  <p className="text-[11px] text-gray-400 line-through font-medium">
                    {service.price} TL
                  </p>
                  <p className="font-bold text-[#10B981] text-[15px]">
                    {service.discountedPrice} TL
                  </p>
                </>
              ) : (
                <p className="font-bold text-[#1F2937] text-[15px]">
                  {service.price} TL
                </p>
              )}
            </div>

            {/* Add/Added Button */}
            <button
              onClick={onToggle}
              className={`px-3 py-1.5 rounded-[10px] font-semibold text-xs transition-all flex items-center gap-1 whitespace-nowrap cursor-pointer ${
                isSelected
                  ? 'bg-[#D4AF37] text-white shadow-sm hover:bg-[#B45309]'
                  : 'bg-white border border-[#D4AF37] text-[#D4AF37] hover:bg-[#FFFBEB]'
              }`}
            >
              {isSelected ? (
                <>
                  <Check className="w-3.5 h-3.5" strokeWidth={3} />
                  <span>Eklendi</span>
                </>
              ) : (
                <>
                  <span className="text-sm leading-none">+</span>
                  <span>Ekle</span>
                </>
              )}
            </button>
          </div>
        </div>

        {/* Configuration Row - Only shown when selected */}
        {isSelected && (
          <div className="mt-4 flex flex-wrap items-center gap-2 animate-in slide-in-from-top-1 fade-in duration-200">
            {/* Staff Selector Chip */}
            <div className="relative">
              <button
                onClick={() => setIsStaffDropdownOpen(!isStaffDropdownOpen)}
                className="px-3 py-1.5 bg-white border border-gray-200 rounded-xl text-xs flex items-center gap-1.5 hover:border-[#D4AF37] transition-colors cursor-pointer text-gray-700 font-medium"
              >
                <User className="w-3.5 h-3.5 text-gray-400" />
                <span>
                  Çalışan:{' '}
                  <span className="text-[#1F2937]">
                    {staffOptions.find((s) => s.id === selectedStaffId)?.name ||
                      'Fark Etmez'}
                  </span>
                </span>
                <ChevronDown className="w-3.5 h-3.5 text-gray-400" />
              </button>

              {/* Staff Dropdown */}
              {isStaffDropdownOpen && (
                <div className="absolute top-full left-0 mt-1 bg-white rounded-xl shadow-lg border border-gray-100 py-1 z-10 min-w-[160px]">
                  {staffOptions.map((staff) => (
                    <button
                      key={staff.id}
                      onClick={() => {
                        onStaffSelect(staff.id);
                        setIsStaffDropdownOpen(false);
                      }}
                      className={`w-full px-4 py-2 text-left hover:bg-gray-50 flex items-center gap-2 cursor-pointer ${
                        selectedStaffId === staff.id ? 'bg-[#FFFBEB]' : ''
                      }`}
                    >
                      <span className="text-base">{staff.emoji}</span>
                      <span className="text-xs font-medium text-[#374151]">
                        {staff.name}
                      </span>
                      {selectedStaffId === staff.id && (
                        <Check className="w-3.5 h-3.5 text-[#D4AF37] ml-auto" />
                      )}
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Guest Selector Chip */}
            <button
              onClick={onToggleGuest}
              className={`px-3 py-1.5 rounded-xl text-xs flex items-center gap-1.5 transition-all cursor-pointer font-medium border ${
                service.forGuest
                  ? 'bg-[#D4AF37] text-white border-[#D4AF37]'
                  : 'bg-white border-gray-200 text-gray-600 hover:border-[#D4AF37]'
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
                className={`px-3 py-1.5 rounded-xl text-xs flex items-center gap-1.5 transition-all cursor-pointer font-medium border ${
                  service.usePackage
                    ? 'bg-[#ECFDF5] text-[#059669] border-[#059669]/20'
                    : 'bg-[#ECFDF5] text-[#059669] border-transparent hover:border-[#059669]/30'
                }`}
              >
                <Package className="w-3.5 h-3.5" />
                <span>Paketimi Kullan</span>
                <span className="opacity-70 text-[10px]">
                  ({service.packageSessionsLeft} kaldı)
                </span>
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
