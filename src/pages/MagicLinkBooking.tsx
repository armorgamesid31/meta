import { useState } from 'react';
import { Header } from '../components/ui/Header.js';
import { QuickActionCards } from '../components/ui/QuickActionCards.js';
import { SearchBar } from '../components/ui/SearchBar.js';
import { ReferralBanner } from '../components/ui/ReferralBanner.js';
import { ServiceAccordion } from '../components/ui/ServiceAccordion.js';
import { ServiceCard } from '../components/ui/ServiceCard.js';
import { DateSelector } from '../components/ui/DateSelector.js';
import { TimeGrid } from '../components/ui/TimeGrid.js';
import { StickyPriceFooter } from '../components/ui/StickyPriceFooter.js';
import { WelcomeModal } from '../components/ui/WelcomeModal.js';
import { Service, Staff } from '../components/ui/types.js';

// --- Dummy Data ---
const DUMMY_STAFF: Staff[] = [
  { id: '1', name: 'Zeynep', emoji: '👩' },
  { id: '2', name: 'Aylin', emoji: '👩‍🦰' },
  { id: '3', name: 'Elif', emoji: '👩‍🦱' },
];

const INITIAL_SERVICES: Service[] = [
  {
    id: '1',
    name: 'Tam Vücut Lazer Paketi',
    duration: '60 dk',
    durationMinutes: 60,
    price: 1800,
    discountedPrice: 1650,
    forGuest: false,
    usePackage: false,
    packageSessionsLeft: 4,
    packageAvailable: true,
    hasSynergy: true,
    synergyBadge: 'Fast Track',
  },
  {
    id: '2',
    name: 'Sırt Lazer',
    duration: '30 dk',
    durationMinutes: 30,
    price: 1200,
    discountedPrice: 1100,
    forGuest: false,
    usePackage: false,
    packageSessionsLeft: 0,
    packageAvailable: false,
  },
  {
    id: '3',
    name: 'Bacak Lazer',
    duration: '45 dk',
    durationMinutes: 45,
    price: 1500,
    forGuest: false,
    usePackage: false,
    packageSessionsLeft: 0,
    packageAvailable: true,
  },
  {
    id: '4',
    name: 'Sir Ağda',
    duration: '20 dk',
    durationMinutes: 20,
    price: 400,
    forGuest: false,
    usePackage: false,
    packageSessionsLeft: 0,
    packageAvailable: false,
  },
];

const DUMMY_DATES = [
  { day: 'Pzt', date: '12', fullDate: '2026-01-12', available: true },
  { day: 'Sal', date: '13', fullDate: '2026-01-13', available: true },
  { day: 'Çar', date: '14', fullDate: '2026-01-14', available: false },
  { day: 'Per', date: '15', fullDate: '2026-01-15', available: true },
  { day: 'Cum', date: '16', fullDate: '2026-01-16', available: true },
  { day: 'Cmt', date: '17', fullDate: '2026-01-17', available: true },
];

const DUMMY_TIMES = {
  morning: ['09:00', '09:30', '10:00', '10:30', '11:00', '11:30'],
  afternoon: ['12:00', '12:30', '13:00', '13:30', '14:00', '14:30', '15:00'],
  evening: ['16:00', '16:30', '17:00', '17:30', '18:00', '18:30', '19:00'],
};

export default function MagicLinkBooking() {
  const [isWelcomeOpen, setIsWelcomeOpen] = useState(false);
  const [selectedGender, setSelectedGender] = useState<'woman' | 'man'>('woman');
  const [searchQuery, setSearchQuery] = useState('');
  const [referralActive, setReferralActive] = useState(false);
  const [referralPhone, setReferralPhone] = useState('');
  
  const [services, setServices] = useState<Service[]>(INITIAL_SERVICES);
  const [selectedServiceIds, setSelectedServiceIds] = useState<string[]>(['1']); // Default selected from Figma
  const [selectedStaffIds, setSelectedStaffIds] = useState<Record<string, string>>({ '1': '1' });
  const [selectedDate, setSelectedDate] = useState<string>('2026-01-13');
  const [selectedTime, setSelectedTime] = useState<string>('12:30');
  const [accordionOpen, setAccordionOpen] = useState(true);

  // Handlers
  const handleServiceToggle = (id: string) => {
    setSelectedServiceIds(prev => 
      prev.includes(id) ? prev.filter(sId => sId !== id) : [...prev, id]
    );
  };

  const handleToggleGuest = (id: string) => {
    setServices(prev => prev.map(s => s.id === id ? { ...s, forGuest: !s.forGuest } : s));
  };

  const handleTogglePackage = (id: string) => {
    setServices(prev => prev.map(s => {
      if (s.id === id) {
        const using = !s.usePackage;
        return { 
          ...s, 
          usePackage: using,
          packageSessionsLeft: using ? s.packageSessionsLeft! - 1 : s.packageSessionsLeft! + 1 
        };
      }
      return s;
    }));
  };

  const handleStaffSelect = (serviceId: string, staffId: string) => {
    setSelectedStaffIds(prev => ({ ...prev, [serviceId]: staffId }));
  };

  const handleRepeatLast = () => {
    // Reset to Figma state
    setSelectedServiceIds(['1']);
    setSelectedStaffIds({ '1': '1' });
    setServices(INITIAL_SERVICES);
  };

  // Calculations
  const filteredServices = services.filter(s => s.name.toLowerCase().includes(searchQuery.toLowerCase()));
  const totalPrice = selectedServiceIds.reduce((sum, id) => {
    const service = services.find(s => s.id === id);
    if (!service || service.usePackage) return sum;
    return sum + (service.discountedPrice || service.price);
  }, 0);

  const totalDuration = selectedServiceIds.reduce((sum, id) => {
    const service = services.find(s => s.id === id);
    return sum + (service?.durationMinutes || 0);
  }, 0);

  return (
    <div className="min-h-screen bg-[#FAFAFA] pb-40 font-sans antialiased text-[#1a1a1a]">
      <div className="max-w-[390px] mx-auto bg-[#FAFAFA] min-h-screen shadow-2xl relative border-x border-gray-100">
        <Header
          customerName="Ayşe"
          selectedGender={selectedGender}
          onGenderClick={() => setIsWelcomeOpen(true)}
        />

        <div className="px-4 py-2 space-y-6">
          <QuickActionCards
            packageCount={3}
            onRepeatClick={handleRepeatLast}
            onPackagesClick={() => {}}
          />

          <SearchBar value={searchQuery} onChange={setSearchQuery} />

          <ReferralBanner
            isActive={referralActive}
            phoneValue={referralPhone}
            onToggle={() => setReferralActive(!referralActive)}
            onPhoneChange={setReferralPhone}
          />

          {/* Service List */}
          <div className="space-y-1">
            <ServiceAccordion
              categoryName="Epilasyon & Tüy Alma"
              icon="✨"
              serviceCount={4}
              isOpen={accordionOpen}
              onToggle={() => setAccordionOpen(!accordionOpen)}
            >
              {filteredServices.map((service) => (
                <ServiceCard
                  key={service.id}
                  service={service}
                  isSelected={selectedServiceIds.includes(service.id)}
                  selectedStaffId={selectedStaffIds[service.id]}
                  staffOptions={DUMMY_STAFF}
                  onToggle={() => handleServiceToggle(service.id)}
                  onToggleGuest={() => handleToggleGuest(service.id)}
                  onTogglePackage={() => handleTogglePackage(service.id)}
                  onStaffSelect={(staffId) => handleStaffSelect(service.id, staffId)}
                />
              ))}
            </ServiceAccordion>

            <ServiceAccordion
              categoryName="Cilt Bakımı & Yüz"
              icon="🧖‍♀️"
              serviceCount={4}
              isOpen={false}
              onToggle={() => {}}
            >
              <div />
            </ServiceAccordion>

            <ServiceAccordion
              categoryName="Vücut Şekillendirme"
              icon="💪"
              serviceCount={3}
              isOpen={false}
              onToggle={() => {}}
            >
              <div />
            </ServiceAccordion>

            <ServiceAccordion
              categoryName="Tırnak Sanatı & Ayak Bakımı"
              icon="💅"
              serviceCount={4}
              isOpen={false}
              onToggle={() => {}}
            >
              <div />
            </ServiceAccordion>
            
            <ServiceAccordion
              categoryName="Kaş & Kirpik"
              icon="👁️"
              serviceCount={4}
              isOpen={false}
              onToggle={() => {}}
            >
              <div />
            </ServiceAccordion>
          </div>

          <DateSelector
            dates={DUMMY_DATES}
            selectedDate={selectedDate}
            onDateSelect={setSelectedDate}
          />

          {selectedDate && (
            <TimeGrid
              timeSlots={DUMMY_TIMES}
              selectedTime={selectedTime}
              onTimeSelect={setSelectedTime}
              totalDuration={totalDuration}
            />
          )}
        </div>

        <StickyPriceFooter
          originalPrice={totalPrice}
          finalPrice={totalPrice}
          showDiscount={false}
          isEnabled={selectedServiceIds.length > 0 && !!selectedDate && !!selectedTime}
          onConfirm={() => alert('Randevu Onaylandı!')}
          onShowBreakdown={() => {}}
        />

        <WelcomeModal
          isOpen={isWelcomeOpen}
          onSelectGender={(gender) => {
            setSelectedGender(gender);
            setIsWelcomeOpen(false);
          }}
        />
      </div>
    </div>
  );
}
