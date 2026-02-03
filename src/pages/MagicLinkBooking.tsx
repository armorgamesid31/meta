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
  const [accordionOpen, setAccordionOpen] = useState(true);
  const [selectedDate, setSelectedDate] = useState<string>('2026-01-13');
  const [selectedTime, setSelectedTime] = useState<string>('12:30');
  const [isBookingInfoOpen, setIsBookingInfoOpen] = useState(false);

  return (
    <div className="min-h-screen bg-white pb-40 font-sans antialiased text-[#1a1a1a]">
      <div className="max-w-[390px] mx-auto bg-white min-h-screen shadow-2xl relative border-x border-gray-100">
        <Header
          customerName="Ayşe"
          selectedGender={selectedGender}
          onGenderClick={() => setIsWelcomeOpen(true)}
        />

        <div className="px-3 py-3 space-y-2.5">
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
          <div className="space-y-2.5">
            <ServiceAccordion
              categoryName="Epilasyon & Tüy Alma"
              icon="✨"
              serviceCount={4}
              isOpen={accordionOpen}
              onToggle={() => setAccordionOpen(!accordionOpen)}
            >
              {DUMMY_SERVICES.map((service) => (
                <ServiceCard
                  key={service.id}
                  service={service}
                  isSelected={service.id === '1'}
                  selectedStaffId="1"
                  staffOptions={DUMMY_STAFF}
                  onToggle={() => {}}
                  onToggleGuest={() => {}}
                  onTogglePackage={() => {}}
                  onStaffSelect={() => {}}
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
              totalDuration={165}
            />
          )}
        </div>

        <StickyPriceFooter
          originalPrice={4150}
          finalPrice={4150}
          showDiscount={false}
          isEnabled={true}
          onConfirm={() => {}}
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
