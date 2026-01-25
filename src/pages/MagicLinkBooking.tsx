import React, { useState, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';

interface MagicLinkData {
  type: 'BOOKING';
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
  };
}

interface Service {
  id: number;
  name: string;
  duration: number;
  price: number;
}

interface Staff {
  id: number;
  name: string;
}

interface AvailabilitySlot {
  date: string;
  slots: string[];
}

const MagicLinkBooking: React.FC = () => {
  const [searchParams] = useSearchParams();
  const token = searchParams.get('token');

  const [magicLinkData, setMagicLinkData] = useState<MagicLinkData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Form state
  const [customerName, setCustomerName] = useState('');
  const [birthDate, setBirthDate] = useState('');
  const [gender, setGender] = useState<'kadin' | 'erkek' | 'belirtmek-istemiyorum'>('kadin');
  const [campaignOptIn, setCampaignOptIn] = useState(false);

  // Booking state
  const [selectedDate, setSelectedDate] = useState('');
  const [selectedTime, setSelectedTime] = useState('');
  const [availableSlots, setAvailableSlots] = useState<string[]>([]);
  const [selectedServices, setSelectedServices] = useState<Array<{serviceId: number, staffId: number}>>([]);

  // UI state
  const [currentStep, setCurrentStep] = useState<'info' | 'services' | 'datetime' | 'confirm'>('info');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!token) {
      setError('Magic link token is missing');
      setLoading(false);
      return;
    }

    // Resolve magic link
    fetch(`/m/${token}`)
      .then(res => res.json())
      .then(data => {
        if (data.message) {
          setError(data.message);
        } else {
          setMagicLinkData(data);
          // Pre-fill name if available
          if (data.customer.name) {
            setCustomerName(data.customer.name);
          }
        }
      })
      .catch(err => {
        console.error('Error resolving magic link:', err);
        setError('Failed to load booking information');
      })
      .finally(() => setLoading(false));
  }, [token]);

  const handleDateChange = async (date: string) => {
    setSelectedDate(date);
    setSelectedTime('');

    if (magicLinkData) {
      try {
        const response = await fetch(`/availability?salonId=${magicLinkData.salon.id}&date=${date}`);
        const data: AvailabilitySlot = await response.json();
        setAvailableSlots(data.slots);
      } catch (error) {
        console.error('Error fetching availability:', error);
      }
    }
  };

  const handleSubmit = async () => {
    if (!magicLinkData || !token || !selectedDate || !selectedTime || selectedServices.length === 0) {
      return;
    }

    setSubmitting(true);

    try {
      const datetime = `${selectedDate}T${selectedTime}:00`;

      const response = await fetch('/appointments', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          token,
          salonId: magicLinkData.salon.id,
          datetime,
          people: [{
            name: customerName,
            birthDate,
            gender,
            services: selectedServices
          }],
          campaignOptIn
        })
      });

      const result = await response.json();

      if (response.ok) {
        alert('Appointment booked successfully!');
        // Could redirect to a success page here
      } else {
        alert(`Booking failed: ${result.message}`);
      }
    } catch (error) {
      console.error('Error booking appointment:', error);
      alert('Failed to book appointment');
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

  if (!magicLinkData) {
    return <div className="min-h-screen flex items-center justify-center">Invalid magic link</div>;
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <div
        className="py-8 px-4 text-center text-white"
        style={{ backgroundColor: magicLinkData.salon.theme.primaryColor }}
      >
        <h1 className="text-3xl font-bold mb-2">{magicLinkData.salon.name}</h1>
        <p className="text-lg opacity-90">Randevu Alın</p>
      </div>

      <div className="max-w-md mx-auto bg-white shadow-lg -mt-4 rounded-t-lg">
        {/* Progress indicator */}
        <div className="flex justify-between px-6 py-4 border-b">
          {['Bilgiler', 'Hizmetler', 'Tarih/Saat', 'Onayla'].map((step, index) => (
            <div
              key={step}
              className={`flex-1 text-center text-sm ${
                index <= ['info', 'services', 'datetime', 'confirm'].indexOf(currentStep)
                  ? 'text-blue-600 font-semibold'
                  : 'text-gray-400'
              }`}
            >
              {step}
            </div>
          ))}
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
              >
                Devam Et
              </button>
            </div>
          )}

          {currentStep === 'services' && (
            <div className="space-y-4">
              <h2 className="text-xl font-semibold mb-4">Hizmet Seçimi</h2>
              <p className="text-gray-600">Hizmet seçimi burada uygulanacak...</p>
              <button
                onClick={() => setCurrentStep('datetime')}
                className="w-full bg-blue-600 text-white py-3 px-4 rounded-md hover:bg-blue-700"
              >
                Devam Et
              </button>
            </div>
          )}

          {currentStep === 'datetime' && (
            <div className="space-y-4">
              <h2 className="text-xl font-semibold mb-4">Tarih ve Saat Seçimi</h2>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Tarih *
                </label>
                <input
                  type="date"
                  value={selectedDate}
                  onChange={(e) => handleDateChange(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                  required
                />
              </div>

              {availableSlots.length > 0 && (
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Saat *
                  </label>
                  <div className="grid grid-cols-3 gap-2">
                    {availableSlots.map(slot => (
                      <button
                        key={slot}
                        onClick={() => setSelectedTime(slot)}
                        className={`py-2 px-3 text-sm border rounded-md ${
                          selectedTime === slot
                            ? 'bg-blue-600 text-white border-blue-600'
                            : 'bg-white text-gray-700 border-gray-300 hover:border-blue-500'
                        }`}
                      >
                        {slot}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              <button
                onClick={() => setCurrentStep('confirm')}
                disabled={!selectedDate || !selectedTime}
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
                <p><strong>İsim:</strong> {customerName}</p>
                <p><strong>Tarih:</strong> {selectedDate}</p>
                <p><strong>Saat:</strong> {selectedTime}</p>
                <p><strong>Salon:</strong> {magicLinkData.salon.name}</p>
              </div>

              <button
                onClick={handleSubmit}
                disabled={submitting}
                className="w-full bg-green-600 text-white py-3 px-4 rounded-md hover:bg-green-700 disabled:bg-gray-400 disabled:cursor-not-allowed"
              >
                {submitting ? 'Randevu Oluşturuluyor...' : 'Randevuyu Onayla'}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default MagicLinkBooking;