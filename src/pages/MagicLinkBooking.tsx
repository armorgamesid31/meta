import React, { useState, useEffect } from 'react';
import { Search } from 'lucide-react';
import { Header } from '../components/Header.js';
import { QuickActionCards } from '../components/QuickActionCards.js';
import { ReferralCard } from '../components/ReferralCard.js';
import { ServiceList, type Service } from '../components/ServiceList.js';
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

  // Use test salon ID
  useEffect(() => {
    setSalonId('55'); // Use salon we created with test data

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

  const handleGenderSelect = (gender: 'woman' | 'man') => {
    setSelectedGender(gender);
    setUserName(gender === 'man' ? 'Ahmet' : 'Ayşe');
    localStorage.setItem('preferredGender', gender === 'man' ? 'MALE' : 'FEMALE');
  };

  const handleServiceToggle = (service: Service, forGuest: boolean = false) => {
    const serviceWithGuest = { ...service, forGuest };
    const existingIndex = booking.services.findIndex(
      s => s.id === service.id && s.forGuest === forGuest
    );

    if (existingIndex >= 0) {
      // Remove service
      setBooking({
        ...booking,
        services: booking.services.filter((_, i) => i !== existingIndex),
      });
    } else {
      // Add service
      setBooking({
        ...booking,
        services: [...booking.services, serviceWithGuest],
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
  const handleTogglePackage = (serviceId: number, serviceData: any) => {
    const existingService = booking.services.find(s => s.id === serviceId);
    
    if (existingService && !existingService.usePackage) {
      // Enable package mode
      const updatedServices = booking.services.map(service => {
        if (service.id === serviceId) {
          return {
            ...service,
            usePackage: true,
            price: 0,
            discountedPrice: 0,
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
      // Disable package mode - revert to normal pricing
      const price = serviceData.price;
      const discountedPrice = serviceData.discountedPrice;
      
      const updatedServices = booking.services.map(service => {
        if (service.id === serviceId) {
          return {
            ...service,
            usePackage: false,
            price,
            discountedPrice,
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
          onServiceToggle={handleServiceToggle}
          onToggleGuest={handleToggleGuest}
          onTogglePackage={handleTogglePackage}
          selectedServices={booking.services}
          searchQuery={searchQuery}
          referralActive={booking.referralActive}
          selectedStaff={booking.selectedStaff}
          onStaffSelect={(staff) => setBooking({ ...booking, selectedStaff: staff })}
          selectedGender={selectedGender === 'woman' ? 'FEMALE' : 'MALE'}
          salonId={salonId || undefined}
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