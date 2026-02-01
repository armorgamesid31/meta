import { useState, useEffect } from 'react';
import { ChevronDown, Check, Package, User, Gift, Zap, Loader2 } from 'lucide-react';

export interface Service {
  id: number;
  name: string;
  duration: number;
  price: number;
  forGuest?: boolean;
}

export interface Staff {
  id: number;
  name: string;
}

interface ServiceListProps {
  onServiceToggle: (service: Service, forGuest?: boolean) => void;
  selectedServices: Service[];
  searchQuery: string;
  referralActive: boolean;
  selectedStaff?: string;
  onStaffSelect: (staffId: string) => void;
  selectedGender: 'FEMALE' | 'MALE';
  salonId?: string;
}

const staffOptions = [
  { id: 'any', name: 'Fark Etmez', emoji: '👤' },
  { id: 'staff1', name: 'Zeynep', emoji: '👩' },
  { id: 'staff2', name: 'Aylin', emoji: '👩‍🦰' },
  { id: 'staff3', name: 'Elif', emoji: '👩‍🦱' },
];

// Service categories with icons (matching reference design)
const serviceCategories = [
  {
    name: 'Saç Hizmetleri',
    icon: '💇‍♀️',
    keywords: ['saç', 'kesim', 'boya', 'bakım']
  },
  {
    name: 'Tırnak Hizmetleri',
    icon: '💅',
    keywords: ['manikür', 'pedikür', 'tırnak']
  },
  {
    name: 'Diğer Hizmetler',
    icon: '✨',
    keywords: [] // Catch-all for remaining services
  }
];

export function ServiceList({
  onServiceToggle,
  selectedServices,
  searchQuery,
  selectedStaff,
  onStaffSelect,
  selectedGender,
  salonId
}: ServiceListProps) {
  const [expandedCategory, setExpandedCategory] = useState<string | null>('Hizmetler');
  const [staffDropdownOpen, setStaffDropdownOpen] = useState<string | null>(null);
  const [services, setServices] = useState<Service[]>([]);
  const [staff, setStaff] = useState<Staff[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Fetch services and staff
  useEffect(() => {
    const fetchData = async () => {
      if (!salonId) return;

      try {
        setLoading(true);
        setError(null);

        // Fetch services
        const servicesResponse = await fetch(`${import.meta.env.VITE_API_BASE_URL || ''}/api/salon/services/public?s=${salonId}`);
        if (!servicesResponse.ok) throw new Error('Failed to fetch services');
        const servicesData = await servicesResponse.json();
        setServices(servicesData.services || []);

        // Fetch staff
        const staffResponse = await fetch(`${import.meta.env.VITE_API_BASE_URL || ''}/api/salon/staff/public?s=${salonId}`);
        if (!staffResponse.ok) throw new Error('Failed to fetch staff');
        const staffData = await staffResponse.json();
        setStaff(staffData.staff || []);

      } catch (err) {
        console.error('Error fetching data:', err);
        setError('Hizmetler yüklenirken hata oluştu');
      } finally {
        setLoading(false);
      }
    };

    fetchData();
  }, [salonId]);

  const toggleCategory = (category: string) => {
    setExpandedCategory(expandedCategory === category ? null : category);
  };

  const getSelectedService = (serviceId: number) => {
    return selectedServices.find(s => s.id === serviceId);
  };

  const isServiceSelected = (serviceId: number) => {
    return selectedServices.some(s => s.id === serviceId);
  };

  const toggleGuestMode = (service: Service) => {
    const existingService = getSelectedService(service.id);
    if (existingService) {
      // Toggle the forGuest property - we'll handle this in the parent component
      onServiceToggle(service, !existingService.forGuest);
    }
  };

  // Filter services based on search
  const filteredServices = services.filter(service => {
    const matchesSearch = service.name.toLowerCase().includes(searchQuery.toLowerCase());
    return matchesSearch;
  });

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
        <button
          onClick={() => window.location.reload()}
          className="mt-2 text-sm text-red-500 underline"
        >
          Tekrar dene
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="bg-white rounded-[20px] overflow-hidden shadow-sm border border-gray-100">
        {/* Category Header */}
        <button
          onClick={() => toggleCategory('Hizmetler')}
          className="w-full px-4 py-4 flex items-center justify-between hover:bg-gray-50 transition-colors"
        >
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 bg-[#D4AF37]/10 rounded-full flex items-center justify-center text-xl">
              💇‍♀️
            </div>
            <span className="font-medium text-[#2D2D2D]">Hizmetler</span>
            <span className="text-xs bg-gray-100 text-gray-600 px-2 py-1 rounded-full">
              {filteredServices.length}
            </span>
          </div>
          <ChevronDown
            className={`w-5 h-5 text-gray-400 transition-transform ${
              expandedCategory === 'Hizmetler' ? 'rotate-180' : ''
            }`}
          />
        </button>

        {/* Service Items */}
        {expandedCategory === 'Hizmetler' && (
          <div className="border-t border-gray-100">
            {filteredServices.length === 0 ? (
              <div className="px-4 py-8 text-center text-gray-500">
                <p>Aramanızla eşleşen hizmet bulunamadı</p>
              </div>
            ) : (
              filteredServices.map((service) => {
                const selectedService = getSelectedService(service.id);
                const isSelected = isServiceSelected(service.id);

                return (
                  <div
                    key={service.id}
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
                            <span className="text-sm text-gray-500">{service.duration}dk</span>
                          </div>
                        </div>

                        <div className="flex items-center gap-3">
                          {/* Price */}
                          <div className="text-right">
                            <p className="font-semibold text-[#2D2D2D]">{service.price} ₺</p>
                          </div>

                          {/* Add/Added Button */}
                          <button
                            onClick={() => {
                              if (isSelected) {
                                // Remove service
                                onServiceToggle(service, selectedService?.forGuest);
                              } else {
                                // Add service for me
                                onServiceToggle(service, false);
                              }
                            }}
                            className={`px-4 py-2 rounded-[12px] font-medium transition-all flex items-center gap-1.5 whitespace-nowrap ${
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
                              onClick={() => setStaffDropdownOpen(staffDropdownOpen === service.id.toString() ? null : service.id.toString())}
                              className="px-3 py-1.5 bg-white border border-gray-200 rounded-full text-sm flex items-center gap-2 hover:border-[#D4AF37] transition-colors"
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
                              <div className="absolute top-full left-0 mt-1 bg-white rounded-[12px] shadow-lg border border-gray-200 py-1 z-10 min-w-[180px]">
                                <button
                                  onClick={() => {
                                    onStaffSelect('any');
                                    setStaffDropdownOpen(null);
                                  }}
                                  className={`w-full px-4 py-2 text-left hover:bg-gray-50 flex items-center gap-2 ${
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
                                    className={`w-full px-4 py-2 text-left hover:bg-gray-50 flex items-center gap-2 ${
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

                          {/* Guest Selector Chip */}
                          <button
                            onClick={() => toggleGuestMode(service)}
                            className={`px-3 py-1.5 rounded-full text-sm flex items-center gap-2 transition-all ${
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
                        </div>
                      )}
                    </div>
                  </div>
                );
              })
            )}
          </div>
        )}
      </div>
    </div>
  );
}