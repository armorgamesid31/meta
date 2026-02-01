import { useState } from 'react';
import { ChevronDown, Check, Package, User, Gift, Loader2 } from 'lucide-react';

export interface Service {
  id: number;
  name: string;
  duration: number;
  price: number;
  discountedPrice?: number;
  forGuest?: boolean;
  usePackage?: boolean;
  packageSessionsLeft?: number;
  packageAvailable?: boolean;
}

export interface Staff {
  id: number;
  name: string;
}

interface ServiceListProps {
  services: Service[]; // Artık filtrelenmiş ve hazır servis listesini alacak
  staff: Staff[]; // Personel listesi dışarıdan gelecek
  loading?: boolean; // Yüklenme durumu dışarıdan gelecek
  error?: string | null; // Hata durumu dışarıdan gelecek
  
  // Selection States (Parent yönetiyor)
  selectedServices: Service[];
  selectedStaff?: string;
  
  // Callbacks
  onServiceToggle: (service: Service) => void;
  onToggleGuest: (serviceId: number) => void;
  onTogglePackage: (serviceId: number, service: Service) => void;
  onStaffSelect: (staffId: string) => void;
  
  // Display Props
  packageSessions?: Record<string, number>;
}

export function ServiceList({
  services,
  staff,
  loading = false,
  error = null,
  selectedServices,
  selectedStaff,
  onServiceToggle,
  onToggleGuest,
  onTogglePackage,
  onStaffSelect,
  packageSessions
}: ServiceListProps) {
  // Sadece UI state'leri burada kalabilir (Dropdown aç/kapa gibi)
  const [staffDropdownOpen, setStaffDropdownOpen] = useState<string | null>(null);

  const getSelectedService = (serviceId: number) => {
    return selectedServices.find(s => s.id === serviceId);
  };

  const isServiceSelected = (serviceId: number) => {
    return selectedServices.some(s => s.id === serviceId);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-8">
        <Loader2 className="w-6 h-6 animate-spin text-[#D4AF37]" />
        <span className="ml-2 text-gray-600">Hizmetler yükleniyor...</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-red-50 border border-red-200 rounded-[20px] p-4 text-center">
        <p className="text-red-600">{error}</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Services Card */}
      <div className="bg-white rounded-[20px] p-6 shadow-premium border border-gray-100 card-premium">
        <div className="flex items-center gap-3 mb-6">
          <div className="w-10 h-10 bg-[#D4AF37]/10 rounded-full flex items-center justify-center">
            <span className="text-xl">💇‍♀️</span>
          </div>
          <div>
            <h3 className="text-lg font-semibold text-[#2D2D2D] text-premium">Hizmet Seçin</h3>
            <p className="text-sm text-gray-500 text-premium">{services.length} hizmet mevcut</p>
          </div>
        </div>

        <div className="space-y-3">
          {services.length === 0 ? (
            <div className="text-center py-8">
              <p className="text-gray-500">Aramanızla eşleşen hizmet bulunamadı</p>
            </div>
          ) : (
            services.map((service) => {
              const selectedService = getSelectedService(service.id);
              const isSelected = isServiceSelected(service.id);

              return (
                <div
                  key={service.id}
                  className={`bg-gray-50 rounded-[16px] p-4 transition-all duration-200 ${
                    isSelected
                      ? 'bg-[#FFFBEB] border-2 border-[#D4AF37] shadow-sm'
                      : 'hover:bg-gray-100 border-2 border-transparent'
                  }`}
                >
                  {/* Service Header */}
                  <div className="flex items-start justify-between gap-4 mb-3">
                    <div className="flex-1">
                      <h4 className="text-base font-semibold text-[#2D2D2D] mb-1">
                        {service.name}
                      </h4>
                      <p className="text-sm text-gray-600">{service.duration} dakika</p>
                    </div>

                    <div className="text-right">
                      {selectedService?.usePackage ? (
                        <p className="text-xl font-bold text-[#10B981]">Ücretsiz</p>
                      ) : service.discountedPrice ? (
                        <>
                          <p className="text-sm text-gray-400 line-through">{service.price} ₺</p>
                          <p className="text-xl font-bold text-[#10B981]">{service.discountedPrice} ₺</p>
                        </>
                      ) : (
                        <p className="text-xl font-bold text-[#2D2D2D]">{service.price} ₺</p>
                      )}
                    </div>
                  </div>

                  {/* Action Button */}
                  <div className="flex justify-end">
                    <button
                      onClick={() => onServiceToggle(service)}
                      className={`px-6 py-3 rounded-[12px] font-semibold transition-all duration-200 flex items-center gap-2 ${
                        isSelected
                          ? 'bg-[#D4AF37] text-white shadow-md hover:bg-[#B8941F]'
                          : 'bg-white border-2 border-[#D4AF37] text-[#D4AF37] hover:bg-[#D4AF37]/5'
                      }`}
                    >
                      {isSelected ? (
                        <>
                          <Check className="w-5 h-5" />
                          <span>Seçildi</span>
                        </>
                      ) : (
                        <>
                          <span className="text-lg">+</span>
                          <span>Seç</span>
                        </>
                      )}
                    </button>
                  </div>

                  {/* Configuration Options - Only when selected */}
                  {isSelected && (
                    <div className="mt-4 pt-4 border-t border-gray-200">
                      <div className="flex flex-wrap gap-3">
                        {/* Staff Selector */}
                        <div className="relative">
                          <button
                            onClick={() => setStaffDropdownOpen(staffDropdownOpen === service.id.toString() ? null : service.id.toString())}
                            className="px-4 py-2 bg-white border border-gray-200 rounded-full text-sm flex items-center gap-2 hover:border-[#D4AF37] transition-colors"
                          >
                            <User className="w-4 h-4 text-gray-500" />
                            <span className="text-[#2D2D2D]">
                              Çalışan: <span className="font-medium">
                                {staff.find(s => s.id.toString() === selectedStaff)?.name || 'Fark Etmez'}
                              </span>
                            </span>
                            <ChevronDown className="w-4 h-4 text-gray-400" />
                          </button>

                          {/* Staff Dropdown */}
                          {staffDropdownOpen === service.id.toString() && (
                            <div className="absolute top-full left-0 mt-2 bg-white rounded-[12px] shadow-lg border border-gray-200 py-1 z-10 min-w-[180px]">
                              <button
                                onClick={() => {
                                  onStaffSelect('any');
                                  setStaffDropdownOpen(null);
                                }}
                                className={`w-full px-4 py-3 text-left hover:bg-gray-50 flex items-center gap-2 ${
                                  selectedStaff === 'any' ? 'bg-[#D4AF37]/10' : ''
                                }`}
                              >
                                <span className="text-lg">👤</span>
                                <span className="text-sm text-[#2D2D2D]">Fark Etmez</span>
                                {selectedStaff === 'any' && (
                                  <Check className="w-4 h-4 text-[#D4AF37] ml-auto" />
                                )}
                              </button>
                              {staff.map((staffMember) => (
                                <button
                                  key={staffMember.id}
                                  onClick={() => {
                                    onStaffSelect(staffMember.id.toString());
                                    setStaffDropdownOpen(null);
                                  }}
                                  className={`w-full px-4 py-3 text-left hover:bg-gray-50 flex items-center gap-2 ${
                                    selectedStaff === staffMember.id.toString() ? 'bg-[#D4AF37]/10' : ''
                                  }`}
                                >
                                  <span className="text-lg">👩</span>
                                  <span className="text-sm text-[#2D2D2D]">{staffMember.name}</span>
                                  {selectedStaff === staffMember.id.toString() && (
                                    <Check className="w-4 h-4 text-[#D4AF37] ml-auto" />
                                  )}
                                </button>
                              ))}
                            </div>
                          )}
                        </div>

                        {/* Guest Mode Toggle */}
                        <button
                          onClick={() => onToggleGuest(service.id)}
                          className={`px-4 py-2 rounded-full text-sm flex items-center gap-2 transition-all ${
                            selectedService?.forGuest
                              ? 'bg-[#D4AF37] text-white'
                              : 'bg-white border border-gray-200 text-[#2D2D2D] hover:border-[#D4AF37]'
                          }`}
                        >
                          {selectedService?.forGuest ? (
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

                        {/* Package Toggle - Only if package available */}
                        {service.packageAvailable && (
                          <button
                            onClick={() => onTogglePackage(service.id, service)}
                            className={`px-4 py-2 rounded-full text-sm flex items-center gap-2 transition-all ${
                              selectedService?.usePackage
                                ? 'bg-[#10B981] text-white'
                                : 'bg-white border border-[#10B981]/30 text-[#10B981] hover:bg-[#10B981]/5'
                            }`}
                          >
                            <Package className="w-4 h-4" />
                            <span>Paketimi Kullan</span>
                            <span className="text-xs opacity-80">
                              ({packageSessions?.[service.id.toString()] || 0} kaldı)
                            </span>
                          </button>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}
