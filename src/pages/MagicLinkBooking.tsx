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
];

const DUMMY_SERVICES: Service[] = [
  {
    id: '1',
    name: 'Saç Kesimi',
    duration: '45 dk',
    durationMinutes: 45,
    price: 1500,
    discountedPrice: 1400,
    forGuest: false,
    usePackage: false,
    packageSessionsLeft: 3,
    packageAvailable: true,
    hasSynergy: true,
    synergyBadge: 'Popüler',
  },
  {
    id: '2',
    name: 'Fön',
    duration: '30 dk',
    durationMinutes: 30,
    price: 500,
    forGuest: true,
    usePackage: false,
    packageSessionsLeft: 0,
    packageAvailable: false,
  },
];

const DUMMY_DATES = [
  { day: 'Pzt', date: '12', fullDate: '2026-01-12', available: true },
  { day: 'Sal', date: '13', fullDate: '2026-01-13', available: true },
  { day: 'Çar', date: '14', fullDate: '2026-01-14', available: false },
];

const DUMMY_TIMES = {
  morning: ['09:00', '10:00', '11:00'],
  afternoon: ['13:00', '14:00', '15:00'],
  evening: ['17:00', '18:00'],
};

export default function MagicLinkBooking() {
  // Purely visual toggles required by Figma interaction
  const [isWelcomeOpen, setIsWelcomeOpen] = useState(true);
  const [selectedGender, setSelectedGender] = useState<'woman' | 'man'>('woman');
  const [searchQuery, setSearchQuery] = useState('');
  const [referralActive, setReferralActive] = useState(false);
  const [referralPhone, setReferralPhone] = useState('');
  const [accordionOpen, setAccordionOpen] = useState(true);
  const [selectedDate, setSelectedDate] = useState<string>();
  const [selectedTime, setSelectedTime] = useState<string>();

  return (
    <div className="min-h-screen bg-[#FAFAFA] pb-32">
      <Header
        customerName="Ayşe"
        selectedGender={selectedGender}
        onGenderClick={() => setIsWelcomeOpen(true)}
      />

      <div className="px-4 py-6 max-w-md mx-auto space-y-6">
        <QuickActionCards
          packageCount={3}
          onRepeatClick={() => {}}
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
        <ServiceAccordion
          categoryName="Saç Tasarımı"
          icon="✂️"
          serviceCount={2}
          isOpen={accordionOpen}
          onToggle={() => setAccordionOpen(!accordionOpen)}
        >
          {DUMMY_SERVICES.map((service) => (
            <ServiceCard
              key={service.id}
              service={service}
              isSelected={service.id === '1'} // Dummy selection
              selectedStaffId="1" // Dummy staff selection
              staffOptions={DUMMY_STAFF}
              onToggle={() => {}}
              onToggleGuest={() => {}}
              onTogglePackage={() => {}}
              onStaffSelect={() => {}}
            />
          ))}
        </ServiceAccordion>

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
            totalDuration={75}
          />
        )}
      </div>

      <StickyPriceFooter
        originalPrice={2000}
        finalPrice={1900}
        showDiscount={true}
        isEnabled={!!(selectedDate && selectedTime)}
        onConfirm={() => {}}
        onShowBreakdown={() => {}}
      />

      <WelcomeModal
        isOpen={isWelcomeOpen}
        onSelectGender={(gender: 'woman' | 'man') => {
          setSelectedGender(gender);
          setIsWelcomeOpen(false);
        }}
      />
    </div>
  );
}
