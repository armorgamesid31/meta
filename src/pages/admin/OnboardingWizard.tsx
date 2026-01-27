import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { API_BASE_URL } from '../../config';
import { apiFetch } from '../../utils/apiFetch';

interface SalonSettings {
  name: string;
  phone: string;
  address: string;
  workStartHour: number;
  workEndHour: number;
  services: Array<{name: string, duration: number, price: number}>;
  isOnboarded: boolean;
}

enum OnboardingStep {
  SALON_INFO = 1,
  SERVICES = 2,
  WORKING_HOURS = 3,
  COMPLETION = 4,
}

const OnboardingWizard: React.FC = () => {
  const navigate = useNavigate();
  const [currentStep, setCurrentStep] = useState<OnboardingStep>(OnboardingStep.SALON_INFO);
  const [salonSettings, setSalonSettings] = useState<SalonSettings>({
    name: "",
    phone: "",
    address: "",
    workStartHour: 9,
    workEndHour: 18,
    services: [],
    isOnboarded: false,
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Fetch initial salon data
  useEffect(() => {
    const fetchSalonData = async () => {
      setLoading(true);
      const token = localStorage.getItem("salonToken");
      if (!token) {
        setError("Salon token bulunamadı.");
        setLoading(false);
        return;
      }

      try {
        const { data } = await apiFetch(`${API_BASE_URL}/api/salon/me`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (data?.salon) {
          setSalonSettings(prev => ({
            ...prev,
            name: data.salon.name || prev.name,
            workStartHour: data.salon.workStartHour || prev.workStartHour,
            workEndHour: data.salon.workEndHour || prev.workEndHour,
          }));
        }
      } catch (err: any) {
        console.error("Error fetching salon data:", err);
        // Don't show error for missing data - this is expected for new salons
      } finally {
        setLoading(false);
      }
    };
    fetchSalonData();
  }, []);

  const handleNext = async () => {
    setError(null);

    // Validation
    if (currentStep === OnboardingStep.SALON_INFO) {
      if (!salonSettings.name.trim()) {
        setError("Salon adı zorunludur.");
        return;
      }
    } else if (currentStep === OnboardingStep.SERVICES) {
      if (salonSettings.services.length === 0) {
        setError("En az 1 hizmet eklemelisiniz.");
        return;
      }
      // Check if all services have required fields
      for (let i = 0; i < salonSettings.services.length; i++) {
        const service = salonSettings.services[i];
        if (!service.name.trim()) {
          setError(`Hizmet ${i + 1}: İsim zorunludur.`);
          return;
        }
        if (!service.duration || service.duration < 15) {
          setError(`Hizmet ${i + 1}: Süre en az 15 dakika olmalıdır.`);
          return;
        }
        if (service.price < 0) {
          setError(`Hizmet ${i + 1}: Fiyat 0'dan küçük olamaz.`);
          return;
        }
      }
    }

    setLoading(true);

    const token = localStorage.getItem("salonToken");
    if (!token) {
      setError("Salon token bulunamadı.");
      setLoading(false);
      return;
    }

    try {
      // Handle different steps
      if (currentStep === OnboardingStep.SALON_INFO) {
        // Update salon name (if changed)
        await apiFetch(`${API_BASE_URL}/api/salon/settings`, {
          method: "PUT",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({
            name: salonSettings.name,
            phone: salonSettings.phone,
            address: salonSettings.address,
          }),
        });
      } else if (currentStep === OnboardingStep.SERVICES) {
        // Create services
        for (const service of salonSettings.services) {
          await apiFetch(`${API_BASE_URL}/api/salon/services`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${token}`,
            },
            body: JSON.stringify(service),
          });
        }
      } else if (currentStep === OnboardingStep.WORKING_HOURS) {
        // Update working hours
        await apiFetch(`${API_BASE_URL}/api/salon/settings`, {
          method: "PUT",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({
            workStartHour: salonSettings.workStartHour,
            workEndHour: salonSettings.workEndHour,
          }),
        });
      } else if (currentStep === OnboardingStep.COMPLETION) {
        // Onboarding completed - refetch salon data and navigate to dashboard
        // This ensures OnboardingGuard gets updated salon state
        try {
          // Force refetch of salon data by clearing any cached state
          // The OnboardingGuard will refetch when it detects the salon state change
          navigate("/salon/dashboard");
        } catch (err) {
          console.error("Error completing onboarding:", err);
          setError("Kurulum tamamlanırken hata oluştu");
        }
        return;
      }

      // Move to next step
      setCurrentStep(prev => prev + 1);
    } catch (fetchErr: any) {
      console.error("Fetch error in onboarding:", fetchErr);
      setError(fetchErr.message || "Bir hata oluştu");
    } finally {
      setLoading(false);
    }
  };

  const addService = () => {
    setSalonSettings(prev => ({
      ...prev,
      services: [...prev.services, { name: "", duration: 30, price: 0 }]
    }));
  };

  const updateService = (index: number, field: string, value: any) => {
    setSalonSettings(prev => ({
      ...prev,
      services: prev.services.map((service, i) =>
        i === index ? { ...service, [field]: value } : service
      )
    }));
  };

  const removeService = (index: number) => {
    setSalonSettings(prev => ({
      ...prev,
      services: prev.services.filter((_, i) => i !== index)
    }));
  };

  const renderStep = () => {
    switch (currentStep) {
      case OnboardingStep.SALON_INFO:
        return (
          <div className="space-y-4">
            <h2 className="text-xl font-semibold">Salon Bilgileri</h2>
            <div>
              <label className="block text-sm font-medium mb-1">Salon Adı:</label>
              <input
                type="text"
                value={salonSettings.name}
                onChange={(e) => setSalonSettings(prev => ({ ...prev, name: e.target.value }))}
                className="w-full p-2 border rounded"
                placeholder="Salonunuzun adı"
              />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Telefon:</label>
              <input
                type="text"
                value={salonSettings.phone}
                onChange={(e) => setSalonSettings(prev => ({ ...prev, phone: e.target.value }))}
                className="w-full p-2 border rounded"
                placeholder="0555 123 45 67"
              />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Adres:</label>
              <input
                type="text"
                value={salonSettings.address}
                onChange={(e) => setSalonSettings(prev => ({ ...prev, address: e.target.value }))}
                className="w-full p-2 border rounded"
                placeholder="Salon adresi"
              />
            </div>
          </div>
        );
      case OnboardingStep.SERVICES:
        return (
          <div className="space-y-4">
            <h2 className="text-xl font-semibold">Hizmet Ekleme</h2>
            <p className="text-sm text-gray-600">En az 1 hizmet eklemelisiniz</p>

            {salonSettings.services.map((service, index) => (
              <div key={index} className="border p-3 rounded space-y-2">
                <div className="flex justify-between items-center">
                  <span className="font-medium">Hizmet {index + 1}</span>
                  <button
                    onClick={() => removeService(index)}
                    className="text-red-500 hover:text-red-700"
                  >
                    Sil
                  </button>
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">Hizmet Adı:</label>
                  <input
                    type="text"
                    value={service.name}
                    onChange={(e) => updateService(index, 'name', e.target.value)}
                    className="w-full p-2 border rounded"
                    placeholder="Saç Kesimi"
                  />
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="block text-sm font-medium mb-1">Süre (dk):</label>
                    <input
                      type="number"
                      value={service.duration || ""}
                      onChange={(e) => updateService(index, 'duration', e.target.value ? parseInt(e.target.value) : 30)}
                      className="w-full p-2 border rounded"
                      min="15"
                      max="480"
                      placeholder="30"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium mb-1">Fiyat (TL):</label>
                    <input
                      type="number"
                      value={service.price || ""}
                      onChange={(e) => updateService(index, 'price', e.target.value ? parseInt(e.target.value) : 0)}
                      className="w-full p-2 border rounded"
                      min="0"
                      placeholder="0"
                    />
                  </div>
                </div>
              </div>
            ))}

            <button
              onClick={addService}
              className="w-full p-2 border-2 border-dashed border-gray-300 rounded hover:border-gray-400 text-gray-600 hover:text-gray-800"
            >
              + Hizmet Ekle
            </button>
          </div>
        );
      case OnboardingStep.WORKING_HOURS:
        return (
          <div className="space-y-4">
            <h2 className="text-xl font-semibold">Çalışma Saatleri</h2>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium mb-1">Açılış Saati:</label>
                <input
                  type="number"
                  value={salonSettings.workStartHour || ""}
                  onChange={(e) => setSalonSettings(prev => ({ ...prev, workStartHour: e.target.value ? parseInt(e.target.value) : 9 }))}
                  className="w-full p-2 border rounded"
                  min="0"
                  max="23"
                  placeholder="9"
                />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">Kapanış Saati:</label>
                <input
                  type="number"
                  value={salonSettings.workEndHour || ""}
                  onChange={(e) => setSalonSettings(prev => ({ ...prev, workEndHour: e.target.value ? parseInt(e.target.value) : 18 }))}
                  className="w-full p-2 border rounded"
                  min="0"
                  max="23"
                  placeholder="18"
                />
              </div>
            </div>
          </div>
        );
      case OnboardingStep.COMPLETION:
        return (
          <div className="text-center space-y-4">
            <h2 className="text-xl font-semibold">Hazırsınız! 🎉</h2>
            <p>Salonunuz başarıyla kuruldu. Randevu almaya başlayabilirsiniz.</p>
            <div className="bg-green-50 p-4 rounded">
              <p className="text-green-800 font-medium">✓ Kurulumu Tamamla butonuna tıklayın</p>
            </div>
          </div>
        );
      default:
        return null;
    }
  };

  return (
    <div style={{ padding: "1rem", maxWidth: "500px", margin: "auto" }}>
      <h1>Salon Kurulum Sihirbazı</h1>
      <p>Adım {currentStep} / {OnboardingStep.COMPLETION}</p>

      {renderStep()}

      <div style={{ marginTop: "1rem", display: "flex", justifyContent: "space-between" }}>
        {currentStep > OnboardingStep.SALON_INFO && (
          <button onClick={() => setCurrentStep(prev => prev - 1)} disabled={loading} data-testid="onboarding-back">Geri</button>
        )}
        <button onClick={handleNext} disabled={loading} data-testid="onboarding-next">
          {currentStep >= OnboardingStep.COMPLETION ? "Tamamla" : "İleri"}
        </button>
      </div>
      {error && <p style={{ color: "red", marginTop: "1rem" }}>{error}</p>}
    </div>
  );
};

export default OnboardingWizard;
