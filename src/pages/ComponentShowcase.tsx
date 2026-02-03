import React, { useState } from 'react';
import {
  WelcomeSelectorCard,
  ServiceCategoryAccordion,
  DateSelector,
  TimeSlotGrid,
  BookingInfoForm,
  BottomPriceSummary,
  PrimaryActionButton,
  FormData,
  TimeSlot,
  Service,
  ServiceCategory,
  PriceBreakdown,
} from '../components/bookingComponents';

export default function ComponentShowcase() {
  // Sample Data
  const datesForDemo: Array<{
    id: string;
    date: Date;
    dayOfMonth: number;
    dayName: string;
    available: boolean;
  }> = [
    {
      id: 'date-1',
      date: new Date(2025, 1, 3),
      dayOfMonth: 3,
      dayName: 'Pazartesi',
      available: true,
    },
    {
      id: 'date-2',
      date: new Date(2025, 1, 4),
      dayOfMonth: 4,
      dayName: 'Salı',
      available: true,
    },
    {
      id: 'date-3',
      date: new Date(2025, 1, 5),
      dayOfMonth: 5,
      dayName: 'Çarşamba',
      available: true,
    },
    {
      id: 'date-4',
      date: new Date(2025, 1, 6),
      dayOfMonth: 6,
      dayName: 'Perşembe',
      available: false,
    },
    {
      id: 'date-5',
      date: new Date(2025, 1, 7),
      dayOfMonth: 7,
      dayName: 'Cuma',
      available: true,
    },
  ];

  const timeSlots: TimeSlot[] = [
    { id: 'time-1', time: '09:00', available: true },
    { id: 'time-2', time: '09:30', available: true },
    { id: 'time-3', time: '10:00', available: true },
    { id: 'time-4', time: '10:30', available: false },
    { id: 'time-5', time: '11:00', available: true },
    { id: 'time-6', time: '11:30', available: true },
    { id: 'time-7', time: '12:00', available: true },
    { id: 'time-8', time: '14:00', available: true },
    { id: 'time-9', time: '14:30', available: true },
  ];

  const services: Service[] = [
    {
      id: 'service-1',
      name: 'Tam Vücut Lazer Paketi',
      description: '60 dk',
      duration: 60,
      price: 1650,
    },
    {
      id: 'service-2',
      name: 'Sırt Lazer',
      description: '30 dk',
      duration: 30,
      price: 1100,
    },
    {
      id: 'service-3',
      name: 'Bacak Lazer',
      description: '45 dk',
      duration: 45,
      price: 1500,
    },
  ];

  const categories: ServiceCategory[] = [
    {
      id: 'cat-1',
      name: 'Epilasyon & Tüy Alma',
      icon: '✨',
      services: services,
    },
    {
      id: 'cat-2',
      name: 'Cilt Bakımı & Yüz',
      icon: '💅',
      services: [
        {
          id: 'service-4',
          name: 'Yüz Temizliği',
          description: '45 dk',
          duration: 45,
          price: 450,
        },
        {
          id: 'service-5',
          name: 'Botox',
          description: '30 dk',
          duration: 30,
          price: 800,
        },
      ],
    },
  ];

  // State Management
  const [selectedDate, setSelectedDate] = useState<string>();
  const [selectedTime, setSelectedTime] = useState<string>();
  const [selectedServices, setSelectedServices] = useState<Service[]>([]);
  const [formData, setFormData] = useState<FormData>({
    name: '',
    phone: '',
    gender: 'female',
    birthDate: '',
  });
  const [expandedCategory, setExpandedCategory] = useState<string | null>(null);

  // Handlers
  const handleSelectService = (service: Service) => {
    setSelectedServices([...selectedServices, service]);
  };

  const handleDeselectService = (serviceId: string) => {
    setSelectedServices(selectedServices.filter((s) => s.id !== serviceId));
  };

  const calculateTotal = (): PriceBreakdown => {
    const subtotal = selectedServices.reduce((sum, s) => sum + s.price, 0);
    return {
      subtotal,
      total: subtotal,
    };
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 to-white p-4 md:p-8">
      <div className="max-w-6xl mx-auto">
        {/* Header */}
        <div className="mb-12">
          <h1 className="text-4xl font-bold text-gray-900 mb-2">
            Salon Booking Components
          </h1>
          <p className="text-gray-600">
            Complete rebuild: 8 presentational components, TypeScript, Tailwind CSS only
          </p>
        </div>

        {/* Main Layout */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          {/* Left Column - Welcome Selector & Forms */}
          <div className="lg:col-span-2 space-y-8">
            {/* 1. Welcome Selector Card */}
            <div className="bg-white rounded-xl shadow-lg p-6">
              <h2 className="text-xl font-bold text-gray-900 mb-4">
                1. WelcomeSelectorCard
              </h2>
              <WelcomeSelectorCard
                title="Randevu Al"
                dates={datesForDemo}
                timeSlots={timeSlots}
                selectedDateId={selectedDate}
                selectedTimeSlotId={selectedTime}
                formData={formData}
                onSelectDate={setSelectedDate}
                onSelectTimeSlot={setSelectedTime}
                onFormChange={setFormData}
                onProceed={() => console.log('Proceeded with booking')}
              />
            </div>

            {/* 2. Service Category Accordion */}
            <div className="bg-white rounded-xl shadow-lg p-6">
              <h2 className="text-xl font-bold text-gray-900 mb-4">
                2. ServiceCategoryAccordion
              </h2>
              <ServiceCategoryAccordion
                categories={categories}
                selectedServices={selectedServices}
                onSelectService={handleSelectService}
                onDeselectService={handleDeselectService}
                expandedCategoryId={expandedCategory}
                onExpandCategory={setExpandedCategory}
              />
            </div>
          </div>

          {/* Right Column - Summary */}
          <div className="space-y-6">
            {/* Component Reference */}
            <div className="bg-white rounded-xl shadow-lg p-6">
              <h3 className="font-bold text-gray-900 mb-4">Components Built</h3>
              <ul className="space-y-2 text-sm">
                {[
                  'PrimaryActionButton',
                  'DateSelector',
                  'TimeSlotGrid',
                  'ServiceCard',
                  'ServiceCategoryAccordion',
                  'BookingInfoForm',
                  'BottomPriceSummary',
                  'WelcomeSelectorCard',
                ].map((comp, i) => (
                  <li key={comp} className="flex items-start gap-2">
                    <span className="text-amber-600 font-bold">{i + 1}.</span>
                    <span className="text-gray-700">{comp}</span>
                  </li>
                ))}
              </ul>
            </div>

            {/* Booking Summary */}
            <div className="bg-white rounded-xl shadow-lg p-6">
              <h3 className="font-bold text-gray-900 mb-4">Booking Summary</h3>
              <div className="space-y-3 text-sm">
                <div>
                  <p className="text-gray-600">Selected Date</p>
                  <p className="font-semibold text-gray-900">
                    {selectedDate
                      ? datesForDemo.find((d) => d.id === selectedDate)?.dayName
                      : 'Not selected'}
                  </p>
                </div>
                <div>
                  <p className="text-gray-600">Selected Time</p>
                  <p className="font-semibold text-gray-900">
                    {selectedTime
                      ? timeSlots.find((t) => t.id === selectedTime)?.time
                      : 'Not selected'}
                  </p>
                </div>
                <div>
                  <p className="text-gray-600">Services ({selectedServices.length})</p>
                  <div className="space-y-1 mt-2">
                    {selectedServices.length === 0 ? (
                      <p className="text-gray-400 italic">No services selected</p>
                    ) : (
                      selectedServices.map((s) => (
                        <p key={s.id} className="text-amber-600 text-xs">
                          {s.name}
                        </p>
                      ))
                    )}
                  </div>
                </div>
                <div className="border-t border-gray-200 pt-3">
                  <p className="text-gray-600">Total Price</p>
                  <p className="text-2xl font-bold text-amber-600">
                    {calculateTotal().total.toLocaleString('tr-TR')} TL
                  </p>
                </div>
              </div>
            </div>

            {/* Design Notes */}
            <div className="bg-amber-50 rounded-xl border border-amber-200 p-6">
              <h4 className="font-bold text-amber-900 mb-2">Design System</h4>
              <ul className="text-xs text-amber-800 space-y-1">
                <li>• Gold primary color (#C9A961)</li>
                <li>• Clean sans-serif typography</li>
                <li>• 8-12px rounded corners</li>
                <li>• Tailwind CSS only</li>
                <li>• Fully responsive</li>
                <li>• Turkish localization</li>
              </ul>
            </div>
          </div>
        </div>

        {/* Bottom Action */}
        <div className="mt-12 bg-white rounded-xl shadow-lg p-8">
          <div className="max-w-sm mx-auto space-y-4">
            <h3 className="text-lg font-bold text-gray-900 text-center">
              Complete Booking
            </h3>
            <PrimaryActionButton
              label="Randevuyu Onayla"
              onClick={() => alert('Booking confirmed!')}
              disabled={
                !selectedDate || !selectedTime || selectedServices.length === 0
              }
            />
            <PrimaryActionButton
              label="Secondary Button"
              variant="secondary"
              onClick={() => alert('Secondary action')}
            />
          </div>
        </div>

        {/* Footer */}
        <div className="mt-12 text-center text-gray-600 text-sm">
          <p>
            All 8 components rebuilt from scratch - React 19, TypeScript, Tailwind CSS
          </p>
          <p className="mt-2">Presentational only • Props-driven • Backend-agnostic</p>
        </div>
      </div>
    </div>
  );
}
