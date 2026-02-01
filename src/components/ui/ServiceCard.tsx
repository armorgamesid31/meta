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
        isSelected ? 'bg-[#FFFBEB] border-l-4 border-l-[#D4AF37]' : 'bg-white'
      }`}
    >
      <div className="px-4 py-4">
        {/* Main Service Row */}
        <div className="flex items-start justify-between gap-3">
          <div className="flex-1 min-w-0">
            <h4 className="font-medium text-[#2D2D2D]">{service.name}</h4>
            <div className="flex items-center gap-2 mt-1 flex-wrap">
              <span className="text-sm text-gray-500">{service.duration}</span>

              {service.hasSynergy && (
                <span className="text-xs bg-gradient-to-r from-[#D4AF37] to-[#F4D03F] text-white px-2 py-0.5 rounded-full flex items-center gap-1 shadow-sm">
                  <Zap className="w-3 h-3" />
                  {service.synergyBadge}
                </span>
              )}

              {service.packageAvailable && !service.hasSynergy && (
                <span className="text-xs bg-[#10B981]/10 text-[#10B981] px-2 py-0.5 rounded-full flex items-center gap-1">
                  <Package className="w-3 h-3" />
                  Paket var
                </span>
              )}
            </div>
          </div>

          <div className="flex items-center gap-3">
            {/* Price */}
            <div className="text-right">
              {service.usePackage ? (
                <p className="font-semibold text-[#10B981]">Ücretsiz</p>
              ) : service.discountedPrice ? (
                <>
                  <p className="text-sm text-gray-400 line-through">
                    {service.price} TL
                  </p>
                  <p className="font-semibold text-[#10B981]">
                    {service.discountedPrice} TL
                  </p>
                </>
              ) : (
                <p className="font-semibold text-[#2D2D2D]">{service.price} TL</p>
              )}
            </div>

            {/* Add/Added Button */}
            <button
              onClick={onToggle}
              className={`px-4 py-2 rounded-[12px] font-medium transition-all flex items-center gap-1.5 whitespace-nowrap cursor-pointer ${
                isSelected
                  ? 'bg-[#D4AF37] text-white shadow-sm'
                  : 'border-2 border-[#D4AF37] text-[#D4AF37] hover:bg-[#D4AF37]/5'
              }`}
            >
              {isSelected ? (
                <>
                  <Check className="w-4 h-4" />
                  <span className="text-sm">Eklendi</span>
                </>
              ) : (
                <>
                  <span className="text-lg leading-none">+</span>
                  <span className="text-sm">Ekle</span>
                </>
              )}
            </button>
          </div>
        </div>

        {/* Configuration Row - Only shown when selected */}
        {isSelected && (
          <div className="mt-4 flex flex-wrap items-center gap-2">
            {/* Staff Selector Chip */}
            <div className="relative">
              <button
                onClick={() => setIsStaffDropdownOpen(!isStaffDropdownOpen)}
                className="px-3 py-1.5 bg-white border border-gray-200 rounded-full text-sm flex items-center gap-2 hover:border-[#D4AF37] transition-colors cursor-pointer"
              >
                <User className="w-4 h-4 text-gray-500" />
                <span className="text-[#2D2D2D]">
                  Çalışan:{' '}
                  <span className="font-medium">
                    {staffOptions.find((s) => s.id === selectedStaffId)?.name ||
                      'Fark Etmez'}
                  </span>
                </span>
                <ChevronDown className="w-4 h-4 text-gray-400" />
              </button>

              {/* Staff Dropdown */}
              {isStaffDropdownOpen && (
                <div className="absolute top-full left-0 mt-1 bg-white rounded-[12px] shadow-lg border border-gray-200 py-1 z-10 min-w-[180px]">
                  {staffOptions.map((staff) => (
                    <button
                      key={staff.id}
                      onClick={() => {
                        onStaffSelect(staff.id);
                        setIsStaffDropdownOpen(false);
                      }}
                      className={`w-full px-4 py-2 text-left hover:bg-gray-50 flex items-center gap-2 cursor-pointer ${
                        selectedStaffId === staff.id ? 'bg-[#D4AF37]/10' : ''
                      }`}
                    >
                      <span className="text-lg">{staff.emoji}</span>
                      <span className="text-sm text-[#2D2D2D]">{staff.name}</span>
                      {selectedStaffId === staff.id && (
                        <Check className="w-4 h-4 text-[#D4AF37] ml-auto" />
                      )}
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Guest Selector Chip */}
            <button
              onClick={onToggleGuest}
              className={`px-3 py-1.5 rounded-full text-sm flex items-center gap-2 transition-all cursor-pointer ${
                service.forGuest
                  ? 'bg-[#D4AF37] text-white'
                  : 'bg-white border border-gray-200 text-[#2D2D2D] hover:border-[#D4AF37]'
              }`}
            >
              {service.forGuest ? (
                <>
                  <Gift className="w-4 h-4" />
                  <span>Misafir için</span>
                </>
              ) : (
                <>
                  <User className="w-4 h-4 text-gray-500" />
                  <span>Bana</span>
                </>
              )}
            </button>

            {/* Package Chip - Only if package available */}
            {service.packageAvailable && (
              <button
                onClick={onTogglePackage}
                className={`px-3 py-1.5 rounded-full text-sm flex items-center gap-2 transition-all cursor-pointer ${
                  service.usePackage
                    ? 'bg-[#10B981] text-white'
                    : 'bg-white border border-[#10B981]/30 text-[#10B981] hover:bg-[#10B981]/5'
                }`}
              >
                <Package className="w-4 h-4" />
                <span>Paketimi Kullan</span>
                <span className="text-xs opacity-80">
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
