import React, { useState, useEffect } from 'react';
import { Search } from 'lucide-react';
import { Header } from '../components/Header.js';
import { QuickActionCards } from '../components/QuickActionCards.js';
import { ReferralCard } from '../components/ReferralCard.js';
import { ServiceList, type Service, type Staff } from '../components/ServiceList.js';
import { DateTimePicker } from '../components/DateTimePicker.js';
import { StickyFooter } from '../components/StickyFooter.js';
import { WelcomeModal } from '../components/WelcomeModal.js';
import { PriceBreakdownModal } from '../components/PriceBreakdownModal.js';
import { BookingModal } from '../components/BookingModal.js';

interface LastAppointment {
  services: Service[];
  date?: string;
  time?: string;
}

const MagicLinkBooking: React.FC = () => {
  const [selectedGender, setSelectedGender] = useState<'woman' | 'man'>('woman');
  const [userName, setUserName] = useState('Ayşe');
  const [booking, setBooking] = useState<{
    services: Service[];
    date?: string;
    time?: string;
    referralPhone?: string;
    referralActive: boolean;
    selectedStaff?: string;
  }>({
    services: [],
    referralActive: false,
  });
  const [searchQuery, setSearchQuery] = useState('');
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isPriceModalOpen, setIsPriceModalOpen] = useState(false);
  const [isWelcomeModalOpen, setIsWelcomeModalOpen] = useState(false);
  const [salonId, setSalonId] = useState<string | null>(null);

  // Data States
  const [services, setServices] = useState<Service[]>([]);
  const [staff, setStaff] = useState<Staff[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  
  // Mock package sessions state
  const [packageSessions, setPackageSessions] = useState<Record<string, number>>({
    '1': 3,
    '2': 5,
    '3': 2,
  });
  
  // Mock last appointment
  const lastAppointment: LastAppointment = {
    services: [
      {
        id: 1,
        name: 'Saç Kesimi',
        duration: 45,
        price: 1500,
        discountedPrice: 1400,
        forGuest: false,
        usePackage: false,
        packageSessionsLeft: 3,
        packageAvailable: true,
      },
    ],
    date: '2025-01-15',
    time: '14:30',
  };

  // Initialize and Fetch Data
  useEffect(() => {
    setSalonId('55'); // Use test salon ID

    // Check if user has preferred gender
    const storedGender = localStorage.getItem('preferredGender');
    if (storedGender === 'MALE') {
      setSelectedGender('man');
      setUserName('Ahmet');
    } else {
      setSelectedGender('woman');
      setUserName('Ayşe');
    }
  }, []);

  // Fetch services and staff when salonId is set
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
        
        // Add mock package data to fetched services
        const enhancedServices = (servicesData.services || []).map((s: any) => ({
          ...s,
          packageAvailable: ['1', '2', '3'].includes(s.id.toString()), // Mock availability
          packageSessionsLeft: packageSessions[s.id.toString()] || 0
        }));
        
        setServices(enhancedServices);

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

  const handleGenderSelect = (gender: 'woman' | 'man') => {
    setSelectedGender(gender);
    setUserName(gender === 'man' ? 'Ahmet' : 'Ayşe');
    localStorage.setItem('preferredGender', gender === 'man' ? 'MALE' : 'FEMALE');
  };

  const handleServiceToggle = (service: Service) => {
    // Check if already selected (by ID)
    const existingIndex = booking.services.findIndex(s => s.id === service.id);

    if (existingIndex >= 0) {
      // Remove service
      setBooking({
        ...booking,
        services: booking.services.filter((_, i) => i !== existingIndex),
      });
    } else {
      // Add service with default values
      const newService = {
        ...service,
        forGuest: false,
        usePackage: false
      };
      
      setBooking({
        ...booking,
        services: [...booking.services, newService],
      });
    }
  };

  // Toggle forGuest for a specific service
  const handleToggleGuest = (serviceId: number) => {
    setBooking({
      ...booking,
      services: booking.services.map(service => {
        if (service.id === serviceId) {
          return { ...service, forGuest: !service.forGuest };
        }
        return service;
      }),
    });
  };

  // Toggle package usage for a specific service
  const handleTogglePackage = (serviceId: number, serviceData: Service) => {
    const existingService = booking.services.find(s => s.id === serviceId);
    
    if (existingService && !existingService.usePackage) {
      // Enable package mode
      const updatedServices = booking.services.map(service => {
        if (service.id === serviceId) {
          return {
            ...service,
            usePackage: true,
            // Price display logic is handled in UI component based on usePackage flag
          };
        }
        return service;
      });
      
      // Decrease package sessions
      setPackageSessions(prev => ({
        ...prev,
        [serviceId.toString()]: Math.max(0, (prev[serviceId.toString()] || 0) - 1),
      }));
      
      setBooking({ ...booking, services: updatedServices });
    } else if (existingService && existingService.usePackage) {
      // Disable package mode
      const updatedServices = booking.services.map(service => {
        if (service.id === serviceId) {
          return {
            ...service,
            usePackage: false,
          };
        }
        return service;
      });
      
      // Increase package sessions back
      setPackageSessions(prev => ({
        ...prev,
        [serviceId.toString()]: (prev[serviceId.toString()] || 0) + 1,
      }));
      
      setBooking({ ...booking, services: updatedServices });
    }
  };

  // Repeat last appointment
  const handleRepeatLastAppointment = () => {
    setBooking({
      ...booking,
      services: lastAppointment.services.map(service => ({
        ...service,
        packageSessionsLeft: packageSessions[service.id.toString()] || 0,
      })),
    });
  };

  const handleDateSelect = (date: string) => {
    setBooking({ ...booking, date });
  };

  const handleTimeSelect = (time: string) => {
    setBooking({ ...booking, time });
  };

  const handleReferralToggle = (active: boolean, phone: string) => {
    setBooking({
      ...booking,
      referralActive: active,
      referralPhone: phone
    });
  };

  const handleConfirmBooking = () => {
    if (booking.services.length > 0 && booking.date && booking.time) {
      setIsModalOpen(true);
    }
  };

  // Filter services based on search query
  const filteredServices = services.filter(service => 
    service.name.toLowerCase().includes(searchQuery.toLowerCase())
  );

  // Calculate totals
  const subtotal = booking.services.reduce((sum, service) => {
    if (service.usePackage) return sum;
    return sum + (service.discountedPrice || service.price);
  }, 0);
  const referralDiscount = booking.referralActive && booking.referralPhone && booking.referralPhone.length === 10 ? 100 : 0;
  const finalPrice = subtotal - referralDiscount;
  const hasDiscount = booking.services.some(s => s.discountedPrice || s.usePackage) || referralDiscount > 0;

  const totalDuration = booking.services.reduce((sum, service) => sum + service.duration, 0);

  return (
    <div className="min-h-screen bg-[#FAFAFA] pb-32 flex flex-col items-center">
      <div className="w-full max-w-[480px] bg-[#FAFAFA] min-h-screen shadow-2xl relative">
      <Header
        customerName={userName}
        selectedGender={selectedGender === 'woman' ? 'FEMALE' : 'MALE'}
        onGenderClick={() => setIsWelcomeModalOpen(true)}
      />

      <div className="px-4 py-6 space-y-6">
        <QuickActionCards
          lastServiceName={lastAppointment.services[0]?.name || 'Saç Kesimi'}
          packageCount={Object.values(packageSessions).reduce((sum, count) => sum + count, 0)}
          onRepeatClick={handleRepeatLastAppointment}
        />

        {/* Search Bar */}
        <div className="relative">
          <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
          <input
            type="text"
            placeholder="Hizmet ara..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full bg-white rounded-[20px] pl-12 pr-4 py-3 text-[#2D2D2D] placeholder:text-gray-400 border border-gray-100 focus:outline-none focus:ring-2 focus:ring-[#D4AF37]/30 shadow-sm"
          />
        </div>

        {/* Referral Card - Growth Hack Position */}
        <ReferralCard
          onToggle={handleReferralToggle}
          active={booking.referralActive}
        />

        <ServiceList
          services={filteredServices}
          staff={staff}
          loading={loading}
          error={error}
          selectedServices={booking.services}
          selectedStaff={booking.selectedStaff}
          onServiceToggle={handleServiceToggle}
          onToggleGuest={handleToggleGuest}
          onTogglePackage={handleTogglePackage}
          onStaffSelect={(staff) => setBooking({ ...booking, selectedStaff: staff })}
          packageSessions={packageSessions}
        />

        {booking.services.length > 0 && (
          <DateTimePicker
            selectedDate={booking.date}
            selectedTime={booking.time}
            onDateSelect={handleDateSelect}
            onTimeSelect={handleTimeSelect}
            totalDuration={totalDuration}
            salonId={salonId || undefined}
          />
        )}
      </div>

      {booking.services.length > 0 && (
        <StickyFooter
          originalPrice={subtotal}
          finalPrice={finalPrice}
          hasDiscount={hasDiscount}
          isEnabled={!!(booking.services.length > 0 && booking.date && booking.time)}
          onConfirm={handleConfirmBooking}
          onShowBreakdown={() => setIsPriceModalOpen(true)}
        />
      )}

      <BookingModal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        booking={booking}
      />

      <PriceBreakdownModal
        isOpen={isPriceModalOpen}
        onClose={() => setIsPriceModalOpen(false)}
        services={booking.services}
        referralDiscount={referralDiscount}
        subtotal={subtotal}
        finalPrice={finalPrice}
      />

      <WelcomeModal
        isOpen={isWelcomeModalOpen}
        onSelectGender={(gender) => {
          handleGenderSelect(gender);
          setIsWelcomeModalOpen(false);
        }}
      />
      </div>
    </div>
  );
};

export default MagicLinkBooking;
