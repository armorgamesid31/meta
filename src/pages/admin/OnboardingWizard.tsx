import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { v4 as uuidv4 } from 'uuid'; // For auto-generating slug

interface SalonInfo {
  name: string;
  slug: string;
}

interface WorkingHours {
  workStartHour: number;
  workEndHour: number;
  slotInterval: number;
}

interface Service {
  name: string;
  duration: number;
  price: number;
}

interface StaffMember {
  name: string;
}

enum OnboardingStep {
  SALON_INFO = 1,
  WORKING_HOURS = 2,
  SERVICES = 3,
  STAFF = 4,
  COMPLETION = 5,
}

const OnboardingWizard: React.FC = () => {
  const navigate = useNavigate();
  const [currentStep, setCurrentStep] = useState<OnboardingStep>(OnboardingStep.SALON_INFO);
  const [salonInfo, setSalonInfo] = useState<SalonInfo>({ name: '', slug: '' });
  const [workingHours, setWorkingHours] = useState<WorkingHours>({ workStartHour: 9, workEndHour: 18, slotInterval: 30 });
  const [services, setServices] = useState<Service[]>([]);
  const [staff, setStaff] = useState<StaffMember[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // Auto-generate slug when salon name changes
    if (salonInfo.name) {
      setSalonInfo(prev => ({ ...prev, slug: generateSlug(salonInfo.name) }));
    }
  }, [salonInfo.name]);

  const generateSlug = (name: string): string => {
    return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  };

  const handleNext = async () => {
    setError(null);
    setLoading(true);

    const token = localStorage.getItem("auth_token");
    if (!token) {
      setError("Authentication token not found.");
      setLoading(false);
      return;
    }

    try {
      switch (currentStep) {
        case OnboardingStep.SALON_INFO:
          const salonInfoResponse = await fetch("http://localhost:3000/api/salon/setup-info", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${token}`,
            },
            body: JSON.stringify(salonInfo),
          });
          if (!salonInfoResponse.ok) {
            throw new Error("Failed to save salon info.");
          }
          const salonData = await salonInfoResponse.json();
          // Assuming backend returns salonId
          // For now, we just proceed. Actual salonId handling would be here.
          break;

        case OnboardingStep.WORKING_HOURS:
          const workingHoursResponse = await fetch("http://localhost:3000/api/salon/setup-working-hours", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${token}`,
            },
            body: JSON.stringify(workingHours),
          });
          if (!workingHoursResponse.ok) {
            throw new Error("Failed to save working hours.");
          }
          break;

        case OnboardingStep.SERVICES:
          const servicesResponse = await fetch("http://localhost:3000/api/salon/setup-services", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${token}`,
            },
            body: JSON.stringify({ services }),
          });
          if (!servicesResponse.ok) {
            throw new Error("Failed to save services.");
          }
          break;

        case OnboardingStep.STAFF:
          const staffResponse = await fetch("http://localhost:3000/api/salon/setup-staff", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${token}`,
            },
            body: JSON.stringify({ staff }),
          });
          if (!staffResponse.ok) {
            throw new Error("Failed to save staff.");
          }
          break;

        case OnboardingStep.COMPLETION:
          const completionResponse = await fetch("http://localhost:3000/api/salon/complete-onboarding", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${token}`,
            },
          });
          if (!completionResponse.ok) {
            throw new Error("Failed to complete onboarding.");
          }
          localStorage.setItem("salon_onboarded", "true");
          navigate("/admin/dashboard");
          break;
      }
      setCurrentStep(prev => prev + 1);
    } catch (err: any) {
      setError(err.message || "An unknown error occurred.");
      console.error("Onboarding step error:", err);
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
              <input type="text" value={salonInfo.name} onChange={(e) => setSalonInfo(prev => ({ ...prev, name: e.target.value }))} />
            </label>
            <label>Salon Slug:
              <input type="text" value={salonInfo.slug} onChange={(e) => setSalonInfo(prev => ({ ...prev, slug: e.target.value }))} />
            </label>
          </div>
        );
      case OnboardingStep.WORKING_HOURS:
        return (
          <div>
            <h2>Çalışma Saatleri</h2>
            <label>Başlangıç Saati:
              <input type="number" value={workingHours.workStartHour} onChange={(e) => setWorkingHours(prev => ({ ...prev, workStartHour: parseInt(e.target.value) }))} />
            </label>
            <label>Bitiş Saati:
              <input type="number" value={workingHours.workEndHour} onChange={(e) => setWorkingHours(prev => ({ ...prev, workEndHour: parseInt(e.target.value) }))} />
            </label>
            <label>Slot Aralığı (dk):
              <input type="number" value={workingHours.slotInterval} onChange={(e) => setWorkingHours(prev => ({ ...prev, slotInterval: parseInt(e.target.value) }))} />
            </label>
          </div>
        );
      case OnboardingStep.SERVICES:
        return (
          <div>
            <h2>Hizmetler</h2>
            {services.map((service, index) => (
              <div key={index}>
                <input
                  type="text"
                  placeholder="Hizmet Adı"
                  value={service.name}
                  onChange={(e) => {
                    const newServices = [...services];
                    newServices[index].name = e.target.value;
                    setServices(newServices);
                  }}
                />
                <input
                  type="number"
                  placeholder="Süre (dk)"
                  value={service.duration}
                  onChange={(e) => {
                    const newServices = [...services];
                    newServices[index].duration = parseInt(e.target.value);
                    setServices(newServices);
                  }}
                />
                <input
                  type="number"
                  placeholder="Fiyat"
                  value={service.price}
                  onChange={(e) => {
                    const newServices = [...services];
                    newServices[index].price = parseFloat(e.target.value);
                    setServices(newServices);
                  }}
                />
                <button onClick={() => setServices(services.filter((_, i) => i !== index))}>Sil</button>
              </div>
            ))}
            <button onClick={() => setServices([...services, { name: '', duration: 30, price: 0 }])}>Hizmet Ekle</button>
          </div>
        );
      case OnboardingStep.STAFF:
        return (
          <div>
            <h2>Personel</h2>
            {staff.map((member, index) => (
              <div key={index}>
                <input
                  type="text"
                  placeholder="Personel Adı"
                  value={member.name}
                  onChange={(e) => {
                    const newStaff = [...staff];
                    newStaff[index].name = e.target.value;
                    setStaff(newStaff);
                  }}
                />
                <button onClick={() => setStaff(staff.filter((_, i) => i !== index))}>Sil</button>
              </div>
            ))}
            <button onClick={() => setStaff([...staff, { name: '' }])}>Personel Ekle</button>
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
    <div style={{ padding: '1rem', maxWidth: '500px', margin: 'auto' }}>
      <h1>Salon Kurulum Sihirbazı</h1>
      <p>Adım {currentStep} / {OnboardingStep.COMPLETION}</p>

      {renderStep()}

      <div style={{ marginTop: '1rem', display: 'flex', justifyContent: 'space-between' }}>
        {currentStep > OnboardingStep.SALON_INFO && (
          <button onClick={() => setCurrentStep(prev => prev - 1)} disabled={loading}>Geri</button>
        )}
        {currentStep < OnboardingStep.COMPLETION && (
          <button onClick={handleNext} disabled={loading}>
            {loading ? 'Kaydediliyor...' : 'İleri'}
          </button>
        )}
      </div>
      {error && <p style={{ color: 'red', marginTop: '1rem' }}>{error}</p>}
    </div>
  );
};

export default OnboardingWizard;
