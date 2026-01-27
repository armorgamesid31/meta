import React, { useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import { apiGet, apiPost } from '../utils/api';

interface MagicLinkData {
  type: 'BOOKING' | 'RESCHEDULE';
  expiresAt: string;
  salon: {
    id: number;
    name: string;
    theme: {
      primaryColor: string;
      secondaryColor: string;
    };
  };
  customer: {
    phone: string;
    name: string | null;
    isReturningCustomer: boolean;
  };
  rescheduleAppointmentId?: number;
}

interface Service {
  id: number;
  name: string;
  duration: number;
  price: number;
  enabled: boolean;
  staff: Staff[];
}

interface Staff {
  id: number;
  name: string;
  enabled: boolean;
}

interface AvailabilitySlot {
  date: string;
  slots: string[];
}

const MagicLinkBooking: React.FC = React.memo(() => {
  const { token } = useParams<{ token: string }>();

  // Mount

  const [magicLinkData, setMagicLinkData] = useState<MagicLinkData | null>(null);
  const [services, setServices] = useState<Service[]>([]);
  const [staff, setStaff] = useState<Staff[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Form state
  const [customerName, setCustomerName] = useState('');
  const [birthDate, setBirthDate] = useState('');
  const [gender, setGender] = useState<'kadin' | 'erkek' | 'belirtmek-istemiyorum'>('kadin');
  const [campaignOptIn, setCampaignOptIn] = useState(false);

  // Booking state
  const [selectedDate, setSelectedDate] = useState('');
  const [selectedSlot, setSelectedSlot] = useState('');
  const [availableSlots, setAvailableSlots] = useState<string[]>([]);
  const [selectedService, setSelectedService] = useState<number | null>(null);
  const [selectedStaff, setSelectedStaff] = useState<number | null>(null);

  // UI state
  const [currentStep, setCurrentStep] = useState<'info' | 'services' | 'date' | 'slot' | 'confirm'>('info');
  const [isReturningCustomer, setIsReturningCustomer] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitSuccess, setSubmitSuccess] = useState(false);
  const [tokenStatus, setTokenStatus] = useState<'valid' | 'EXPIRED' | 'USED' | 'invalid' | 'SALON_NOT_READY'>('valid');

  // Debug logging
  useEffect(() => {
    console.log('Current step:', currentStep);
    console.log('Selected date:', selectedDate);
    console.log('Selected slot:', selectedSlot);
    console.log('Available slots:', availableSlots);
    console.log('Button disabled state:', !selectedDate || !selectedSlot);
  }, [currentStep, selectedDate, selectedSlot, availableSlots]);

  useEffect(() => {
    if (!token) {
      setError('Magic link token is missing');
      setLoading(false);
      return;
    }

    // Resolve magic link
    apiGet(`/api/magic-links/${token}`)
      .then(res => res.json())
      .then(data => {
        // Handle structured error responses
        if (data.ok === false) {
          setTokenStatus('invalid');
          setError(data.message || 'Bağlantı geçersiz veya süresi dolmuş');
          return;
        }

        // Handle legacy status responses for backward compatibility
        if (data.status === 'USED') {
          setTokenStatus('USED');
          setMagicLinkData(data.salon);
          setError('Bu bağlantı daha önce kullanılmış');
          return;
        }

        if (data.status === 'EXPIRED') {
          setTokenStatus('EXPIRED');
          setMagicLinkData(data.salon);
          setError('Bu bağlantının süresi dolmuş');
          return;
        }

        if (data.status === 'SALON_NOT_READY') {
          setTokenStatus('SALON_NOT_READY');
          setMagicLinkData(data.salon);
          setError(data.message || 'Salon henüz hazır değil');
          return;
        }

        // Success case - data should have ok: true
        if (data.ok === true && data.salon?.id) {
          setMagicLinkData(data);
          setTokenStatus('valid');
          setIsReturningCustomer(data.customer?.isReturningCustomer || false);

          // Pre-fill name if available
          if (data.customer?.name) {
            setCustomerName(data.customer.name);
          }

          // Set initial step based on customer type
          if (data.customer?.isReturningCustomer) {
            setCurrentStep('services'); // Skip info step for returning customers
          } else {
            setCurrentStep('info'); // Show info step for new customers
          }

          // Services and staff will be loaded by the separate useEffect below
        } else {
          // Unexpected response format
          console.error('Unexpected magic link response:', data);
          setError('Bağlantı bilgileri alınamadı');
        }
      })
      .catch(err => {
        console.error('Network error resolving magic link:', err);
        setError('Bağlantı kontrol edilemedi. Lütfen internet bağlantınızı kontrol edin.');
      })
      .finally(() => setLoading(false));
  }, [token]);

  // Load services and staff ONLY after magic link data is loaded
  useEffect(() => {
    if (!magicLinkData || !magicLinkData.salon?.id || tokenStatus !== 'valid') {
      return;
    }

    console.log('Loading services and staff for salonId:', magicLinkData.salon.id);

    // Load services and staff for this salon (public endpoints)
    Promise.all([
      apiGet(`/api/salon/services/public?s=${magicLinkData.salon.id}`)
        .then(res => res.json())
        .catch(err => {
          console.error('Error loading services:', err);
          return { services: [] };
        }),
      apiGet(`/api/salon/staff/public?s=${magicLinkData.salon.id}`)
        .then(res => res.json())
        .catch(err => {
          console.error('Error loading staff:', err);
          return { staff: [] };
        })
    ]).then(([serviceData, staffData]) => {
      const services = serviceData.services || [];
      const staff = staffData.staff || [];

      console.log(`Loaded ${services.length} services and ${staff.length} staff for salon ${magicLinkData.salon.id}`);

      setServices(services);
      setStaff(staff);

      // Validate that we have required data
      if (services.length === 0) {
        setError('Bu salonda henüz hiç hizmet tanımlanmamış. Lütfen salon sahibi ile iletişime geçin.');
        return;
      }

      if (staff.length === 0) {
        setError('Bu salonda henüz hiç personel eklenmemiş. Lütfen salon sahibi ile iletişime geçin.');
        return;
      }
    }).catch(err => {
      console.error('Error loading salon data:', err);
      setError('Salon bilgileri yüklenirken hata oluştu');
    });
  }, [magicLinkData, tokenStatus]);

  const handleDateChange = async (date: string) => {
    console.log('Date changed:', date);
    setSelectedDate(date);
    // Don't clear selectedSlot when date changes - only clear it if date actually changed
    if (selectedDate !== date) {
      setSelectedSlot(''); // Only clear slot if date actually changed
    }
    setAvailableSlots([]); // Clear previous slots

    if (magicLinkData) {
      try {
        const response = await apiGet(`/availability?salonId=${magicLinkData.salon.id}&date=${date}`);
        const data: AvailabilitySlot = await response.json();
        setAvailableSlots(data?.slots || []);
        console.log('Available slots loaded:', data?.slots);
      } catch (error) {
        console.error('Error fetching availability:', error);
        setAvailableSlots([]);
      }
    }
  };

  const handleSubmit = async () => {
    if (!magicLinkData || !token || !selectedDate || !selectedSlot || !selectedService || !selectedStaff) {
      return;
    }

    setSubmitting(true);
    setSubmitError(null);
    setSubmitSuccess(false);

    try {
      const datetime = `${selectedDate}T${selectedSlot}:00`;

      // For new customers, include full customer info to create/update customer record
      const appointmentData: any = {
        token,
        salonId: magicLinkData.salon.id,
        datetime,
        people: [{
          name: customerName,
          services: [{
            serviceId: selectedService,
            staffId: selectedStaff
          }]
        }]
      };

      // Add customer details for new customers
      if (!isReturningCustomer) {
        appointmentData.people[0].birthDate = birthDate;
        appointmentData.people[0].gender = gender;
        appointmentData.campaignOptIn = campaignOptIn;
      }

      const response = await apiPost('/appointments', appointmentData);

      const result = await response.json();

      if (response.ok) {
        setSubmitSuccess(true);
        // Could redirect to a success page here
      } else {
        setSubmitError(result.message || 'Randevu oluşturulamadı');
      }
    } catch (error) {
      console.error('Error booking appointment:', error);
      setSubmitError('Randevu oluşturulurken bir hata oluştu');
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return <div className="min-h-screen flex items-center justify-center">Loading...</div>;
  }

  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <h1 className="text-2xl font-bold text-red-600 mb-4">Error</h1>
          <p className="text-gray-600">{error}</p>
        </div>
      </div>
    );
  }

  // Show token state screens
  if (tokenStatus === 'EXPIRED') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="max-w-md mx-auto bg-white shadow-lg rounded-lg p-8 text-center">
          <div className="mb-6">
            <div className="w-16 h-16 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-4">
              <span className="text-2xl">⏰</span>
            </div>
            <h1 className="text-2xl font-bold text-gray-900 mb-2">Bağlantı Süresi Dolmuş</h1>
            <p className="text-gray-600">
              Bu randevu bağlantısının süresi dolmuş. Yeni bir bağlantı için salon ile iletişime geçin.
            </p>
          </div>

          <div className="bg-gray-50 p-4 rounded-lg mb-6">
            <h3 className="font-medium text-gray-900 mb-2">{(magicLinkData as any).name}</h3>
            <p className="text-sm text-gray-600 mb-2">{(magicLinkData as any).address}</p>
            <p className="text-sm text-gray-600">📞 {(magicLinkData as any).phone}</p>
          </div>

          <button
            onClick={() => window.location.href = `tel:${(magicLinkData as any).phone}`}
            className="w-full bg-blue-600 text-white py-3 px-4 rounded-md hover:bg-blue-700"
          >
            Salon ile İletişime Geç
          </button>
        </div>
      </div>
    );
  }

  if (tokenStatus === 'USED') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="max-w-md mx-auto bg-white shadow-lg rounded-lg p-8 text-center">
          <div className="mb-6">
            <div className="w-16 h-16 bg-yellow-100 rounded-full flex items-center justify-center mx-auto mb-4">
              <span className="text-2xl">✅</span>
            </div>
            <h1 className="text-2xl font-bold text-gray-900 mb-2">Bağlantı Kullanılmış</h1>
            <p className="text-gray-600">
              Bu randevu bağlantısı daha önce kullanılmış. Her bağlantı sadece bir kez kullanılabilir.
            </p>
          </div>

          <div className="bg-gray-50 p-4 rounded-lg mb-6">
            <h3 className="font-medium text-gray-900 mb-2">{(magicLinkData as any).name}</h3>
            <p className="text-sm text-gray-600">{(magicLinkData as any).address}</p>
          </div>

          <p className="text-sm text-gray-500">
            Başka bir randevu için yeni bir bağlantı isteyin.
          </p>
        </div>
      </div>
    );
  }

  if (tokenStatus === 'SALON_NOT_READY') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="max-w-md mx-auto bg-white shadow-lg rounded-lg p-8 text-center">
          <div className="mb-6">
            <div className="w-16 h-16 bg-orange-100 rounded-full flex items-center justify-center mx-auto mb-4">
              <span className="text-2xl">⚠️</span>
            </div>
            <h1 className="text-2xl font-bold text-gray-900 mb-2">Salon Henüz Hazır Değil</h1>
            <p className="text-gray-600">
              Bu salon henüz randevu almaya hazır değil. Lütfen salon sahibi ile iletişime geçin.
            </p>
          </div>

          <div className="bg-gray-50 p-4 rounded-lg mb-6">
            <h3 className="font-medium text-gray-900 mb-2">{(magicLinkData as any).name}</h3>
            <p className="text-sm text-gray-600 mb-2">{(magicLinkData as any).address}</p>
            <p className="text-sm text-gray-600">📞 Salon sahibi ile iletişime geçin</p>
          </div>

          <p className="text-sm text-gray-500">
            Salon kurulumu tamamlandıktan sonra tekrar deneyin.
          </p>
        </div>
      </div>
    );
  }

  if (!magicLinkData) {
    return <div className="min-h-screen flex items-center justify-center">Invalid magic link</div>;
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <div
        className="py-8 px-4 text-center text-white"
        style={{
          backgroundColor: magicLinkData.salon?.theme?.primaryColor || '#10b981'
        }}
      >
        <h1 className="text-3xl font-bold mb-2">{magicLinkData.salon?.name || 'Salon'}</h1>
        <p className="text-lg opacity-90">Randevu Alın</p>
      </div>

      <div className="max-w-md mx-auto bg-white shadow-lg -mt-4 rounded-t-lg">
        {/* Reschedule Banner */}
        {magicLinkData?.type === 'RESCHEDULE' && (
          <div className="bg-blue-50 border-b border-blue-200 px-6 py-3">
            <div className="flex items-center">
              <div className="flex-shrink-0">
                <span className="text-blue-600">🔄</span>
              </div>
              <div className="ml-3">
                <p className="text-sm text-blue-800">
                  Bu randevu değişikliği için kullanılacak bağlantıdır.
                </p>
              </div>
            </div>
          </div>
        )}

        {/* Progress indicator - adapts based on customer type */}
        <div className="flex justify-between px-6 py-4 border-b">
          {isReturningCustomer
            ? ['Hizmetler', 'Tarih', 'Saat', 'Onayla'].map((step, index) => {
                const stepOrder = ['services', 'date', 'slot', 'confirm'];
                const currentIndex = stepOrder.indexOf(currentStep);
                const isActive = index <= currentIndex;

                return (
                  <div
                    key={step}
                    className={`flex-1 text-center text-sm ${
                      isActive ? 'text-blue-600 font-semibold' : 'text-gray-400'
                    }`}
                  >
                    {step}
                  </div>
                );
              })
            : ['Bilgiler', 'Hizmetler', 'Tarih', 'Saat', 'Onayla'].map((step, index) => {
                const stepOrder = ['info', 'services', 'date', 'slot', 'confirm'];
                const currentIndex = stepOrder.indexOf(currentStep);
                const isActive = index <= currentIndex;

                return (
                  <div
                    key={step}
                    className={`flex-1 text-center text-sm ${
                      isActive ? 'text-blue-600 font-semibold' : 'text-gray-400'
                    }`}
                  >
                    {step}
                  </div>
                );
              })
          }
        </div>

        <div className="p-6">
          {currentStep === 'info' && (
            <div className="space-y-4">
              <h2 className="text-xl font-semibold mb-4">Kişisel Bilgiler</h2>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Ad Soyad *
                </label>
                <input
                  type="text"
                  value={customerName}
                  onChange={(e) => setCustomerName(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                  required
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Doğum Tarihi *
                </label>
                <input
                  type="date"
                  value={birthDate}
                  onChange={(e) => setBirthDate(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                  required
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Cinsiyet *
                </label>
                <select
                  value={gender}
                  onChange={(e) => setGender(e.target.value as any)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option value="kadin">Kadın</option>
                  <option value="erkek">Erkek</option>
                  <option value="belirtmek-istemiyorum">Belirtmek İstemiyorum</option>
                </select>
              </div>

              <div className="flex items-center">
                <input
                  type="checkbox"
                  id="campaignOptIn"
                  checked={campaignOptIn}
                  onChange={(e) => setCampaignOptIn(e.target.checked)}
                  className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded"
                />
                <label htmlFor="campaignOptIn" className="ml-2 text-sm text-gray-700">
                  Kampanya ve promosyonlardan haberdar olmak istiyorum
                </label>
              </div>

              <button
                onClick={() => setCurrentStep('services')}
                disabled={!customerName || !birthDate}
                className="w-full bg-blue-600 text-white py-3 px-4 rounded-md hover:bg-blue-700 disabled:bg-gray-400 disabled:cursor-not-allowed"
                data-testid="booking-next"
              >
                Devam Et
              </button>
            </div>
          )}

          {currentStep === 'services' && (
            <div className="space-y-4">
              <h2 className="text-xl font-semibold mb-4">Hizmet Seçimi</h2>

              {/* TEMPORARY DEBUG - REMOVE AFTER FIXING */}
              <pre style={{ fontSize: '10px', background: '#f0f0f0', padding: '5px', marginBottom: '10px' }}>
                {JSON.stringify({ servicesLength: services.length, staffLength: staff.length, services, staff }, null, 2)}
              </pre>

              {services.length === 0 ? (
                <div className="text-center py-8">
                  <p className="text-gray-500">Bu salon için henüz hizmet tanımlanmamış.</p>
                  <p className="text-sm text-gray-400 mt-2">Lütfen salon sahibi ile iletişime geçin.</p>
                </div>
              ) : (
                <div className="space-y-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Hizmet Seçin *
                    </label>
                    <div className="space-y-2">
                      {services.map(service => (
                        <div
                          key={service.id}
                          onClick={() => setSelectedService(service.id)}
                          className={`p-3 border rounded-md cursor-pointer ${
                            selectedService === service.id
                              ? 'border-blue-500 bg-blue-50'
                              : 'border-gray-300 hover:border-blue-300'
                          }`}
                          data-testid="booking-service-item"
                        >
                          <div className="flex justify-between items-center">
                            <div>
                              <h3 className="font-medium">{service.name}</h3>
                              <p className="text-sm text-gray-600">{service.duration} dakika - ₺{service.price}</p>
                            </div>
                            {selectedService === service.id && (
                              <span className="text-blue-600">✓</span>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>

                  {selectedService && (
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">
                        Personel Seçin *
                      </label>
                      <div className="space-y-2">
                        {staff.map(person => (
                          <div
                            key={person.id}
                            onClick={() => setSelectedStaff(person.id)}
                            className={`p-3 border rounded-md cursor-pointer ${
                              selectedStaff === person.id
                                ? 'border-blue-500 bg-blue-50'
                                : 'border-gray-300 hover:border-blue-300'
                            }`}
                          >
                            <div className="flex justify-between items-center">
                              <span className="font-medium">{person.name}</span>
                              {selectedStaff === person.id && (
                                <span className="text-blue-600">✓</span>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}

              <button
                onClick={() => setCurrentStep('date')}
                disabled={!selectedService || !selectedStaff}
                className="w-full bg-blue-600 text-white py-3 px-4 rounded-md hover:bg-blue-700 disabled:bg-gray-400 disabled:cursor-not-allowed"
              >
                Devam Et
              </button>
            </div>
          )}

          {currentStep === 'date' && (
            <div className="space-y-4">
              <h2 className="text-xl font-semibold mb-4">Tarih Seçimi</h2>
              <div className="grid grid-cols-3 gap-2">
                <button
                  onClick={() => {
                    const today = new Date().toISOString().split('T')[0];
                    console.log('Date selected: today', today);
                    handleDateChange(today);
                    setCurrentStep('slot');
                  }}
                  className="py-3 px-4 text-sm bg-blue-600 text-white rounded-md hover:bg-blue-700"
                >
                  Bugün
                </button>
                <button
                  onClick={() => {
                    const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString().split('T')[0];
                    console.log('Date selected: tomorrow', tomorrow);
                    handleDateChange(tomorrow);
                    setCurrentStep('slot');
                  }}
                  className="py-3 px-4 text-sm bg-blue-600 text-white rounded-md hover:bg-blue-700"
                >
                  Yarın
                </button>
                <button
                  onClick={() => {
                    const dayAfter = new Date(Date.now() + 2 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
                    console.log('Date selected: +2 days', dayAfter);
                    handleDateChange(dayAfter);
                    setCurrentStep('slot');
                  }}
                  className="py-3 px-4 text-sm bg-blue-600 text-white rounded-md hover:bg-blue-700"
                >
                  2 Gün Sonra
                </button>
              </div>
            </div>
          )}

          {currentStep === 'slot' && (
            <div className="space-y-4">
              <h2 className="text-xl font-semibold mb-4">Saat Seçimi</h2>
              <p className="text-gray-600 mb-4">
                Seçilen tarih: {selectedDate ? new Date(selectedDate).toLocaleDateString('tr-TR') : 'Tarih seçilmedi'}
              </p>

              {Array.isArray(availableSlots) && availableSlots.length > 0 ? (
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Uygun Saatler *
                  </label>
                  <div className="grid grid-cols-3 gap-2">
                    {availableSlots.map(slot => (
                      <button
                        key={slot}
                        onClick={() => {
                          console.log('Time slot selected:', slot);
                          setSelectedSlot(slot);
                        }}
                        className={`py-2 px-3 text-sm border rounded-md ${
                          selectedSlot === slot
                            ? 'bg-blue-600 text-white border-blue-600'
                            : 'bg-white text-gray-700 border-gray-300 hover:border-blue-500'
                        }`}
                        data-testid="booking-slot-item"
                      >
                        {slot}
                      </button>
                    ))}
                  </div>
                </div>
              ) : (
                <div className="text-center py-8">
                  <p className="text-gray-500">Bu tarih için uygun saat bulunamadı.</p>
                  <button
                    onClick={() => setCurrentStep('date')}
                    className="mt-4 text-blue-600 hover:text-blue-800"
                  >
                    Farklı tarih seç
                  </button>
                </div>
              )}

              <button
                onClick={() => {
                  console.log('Attempting to go to confirm step');
                  console.log('selectedDate:', selectedDate, 'selectedSlot:', selectedSlot);
                  console.log('Button should be enabled:', !!(selectedDate && selectedSlot));
                  setCurrentStep('confirm');
                }}
                disabled={!selectedDate || !selectedSlot}
                className="w-full bg-blue-600 text-white py-3 px-4 rounded-md hover:bg-blue-700 disabled:bg-gray-400 disabled:cursor-not-allowed"
              >
                Devam Et
              </button>
            </div>
          )}

          {currentStep === 'confirm' && (
            <div className="space-y-4">
              <h2 className="text-xl font-semibold mb-4">Onay</h2>

              <div className="bg-gray-50 p-4 rounded-md space-y-2">
                <p><strong>İsim:</strong> {customerName || 'Belirtilmemiş'}</p>
                <p><strong>Hizmet:</strong> {selectedService ? services.find(s => s.id === selectedService)?.name : 'Belirtilmemiş'}</p>
                <p><strong>Personel:</strong> {selectedStaff ? staff.find(s => s.id === selectedStaff)?.name : 'Belirtilmemiş'}</p>
                <p><strong>Tarih:</strong> {selectedDate || 'Belirtilmemiş'}</p>
                <p><strong>Saat:</strong> {selectedSlot || 'Belirtilmemiş'}</p>
                <p><strong>Salon:</strong> {magicLinkData.salon?.name || 'Salon'}</p>
              </div>

              {submitError && (
                <div className="text-red-600 text-sm text-center bg-red-50 p-3 rounded-md">
                  {submitError}
                </div>
              )}

              {submitSuccess && (
                <div className="text-green-600 text-sm text-center bg-green-50 p-3 rounded-md">
                  Randevunuz başarıyla oluşturuldu! Salon sahibi kısa sürede sizinle iletişime geçecektir.
                </div>
              )}

              <button
                onClick={handleSubmit}
                disabled={submitting || submitSuccess}
                className="w-full bg-green-600 text-white py-3 px-4 rounded-md hover:bg-green-700 disabled:bg-gray-400 disabled:cursor-not-allowed"
                data-testid="booking-confirm"
              >
                {submitting ? 'Randevu Oluşturuluyor...' : submitSuccess ? 'Randevu Oluşturuldu' : 'Randevuyu Onayla'}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
});

export default MagicLinkBooking;
