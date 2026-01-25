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
  isOnboarded: boolean;
}

enum OnboardingStep {
  SALON_INFO = 1,
  WORKING_HOURS = 2,
  COMPLETION = 3,
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
    isOnboarded: false,
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Fetch initial salon settings
  useEffect(() => {
    const fetchSettings = async () => {
      setLoading(true);
      const token = localStorage.getItem("auth_token");
      if (!token) {
        setError("Authentication token not found.");
        setLoading(false);
        return;
      }

      try {
        const { data } = await apiFetch(`${API_BASE_URL}/api/salon/settings`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (data) {
          setSalonSettings(prev => ({ ...prev, ...data }));
        }
      } catch (err: any) {
        console.error("Error fetching salon settings:", err);
        setError(err.message || "Ayarlar getirilirken bir hata oluştu.");
      } finally {
        setLoading(false);
      }
    };
    fetchSettings();
  }, []);

  const handleNext = async () => {
    setError(null);
    setLoading(true);

    const token = localStorage.getItem("auth_token");
    if (!token) {
      setError("Authentication token not found.");
      setLoading(false);
      return;
    }

    const isCompletionStep = currentStep === OnboardingStep.COMPLETION;

    try {
      await apiFetch(`${API_BASE_URL}/api/salon/settings`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ ...salonSettings, isOnboarded: isCompletionStep }),
      });

      // If we get here, the request was successful
      if (isCompletionStep) {
        navigate("/admin/dashboard");
      } else {
        setCurrentStep(prev => prev + 1);
      }
    } catch (fetchErr: any) {
      console.error("Fetch error in onboarding:", fetchErr);
      setError(fetchErr.message || "Fetch error");
    } finally {
      setLoading(false);
    }
  };

  const renderStep = () => {
    switch (currentStep) {
      case OnboardingStep.SALON_INFO:
        return (
          <div>
            <h2>Salon Bilgileri</h2>
            <label>Salon Adı:
              <input type="text" value={salonSettings.name} readOnly />
            </label>
            <label>Telefon:
              <input type="text" value={salonSettings.phone} onChange={(e) => setSalonSettings(prev => ({ ...prev, phone: e.target.value }))} />
            </label>
            <label>Adres:
              <input type="text" value={salonSettings.address} onChange={(e) => setSalonSettings(prev => ({ ...prev, address: e.target.value }))} />
            </label>
          </div>
        );
      case OnboardingStep.WORKING_HOURS:
        return (
          <div>
            <h2>Çalışma Saatleri</h2>
            <label>Başlangıç Saati:
              <input type="number" value={salonSettings.workStartHour} onChange={(e) => setSalonSettings(prev => ({ ...prev, workStartHour: parseInt(e.target.value) }))} />
            </label>
            <label>Bitiş Saati:
              <input type="number" value={salonSettings.workEndHour} onChange={(e) => setSalonSettings(prev => ({ ...prev, workEndHour: parseInt(e.target.value) }))} />
            </label>
          </div>
        );
      case OnboardingStep.COMPLETION:
        return (
          <div>
            <h2>Hazırsınız!</h2>
            <p>Onboarding tamamlandı. Yönetim paneline yönlendiriliyorsunuz...</p>
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
          <button onClick={() => setCurrentStep(prev => prev - 1)} disabled={loading}>Geri</button>
        )}
        <button onClick={handleNext} disabled={loading}>
          {currentStep >= OnboardingStep.COMPLETION ? "Tamamla" : "İleri"}
        </button>
      </div>
      {error && <p style={{ color: "red", marginTop: "1rem" }}>{error}</p>}
    </div>
  );
};

export default OnboardingWizard;
