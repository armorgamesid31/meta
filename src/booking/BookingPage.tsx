import React, { useState, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { BookingLayout } from './BookingLayout.js';
import { StepService } from './components/StepService.js';
import { StepTime } from './components/StepTime.js';
import { StepConfirm } from './components/StepConfirm.js';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

export function BookingPage() {
  const [searchParams] = useSearchParams();
  const token = searchParams.get('token');
  
  const [step, setStep] = useState(1);
  const [selectedServiceId, setSelectedServiceId] = useState<string | null>(null);
  const [selectedDateTime, setSelectedDateTime] = useState<{ date: string; time: string } | null>(null);
  const [isConfirmed, setIsConfirmed] = useState(false);

  // Mock validation/loading
  const [isValidating, setIsValidating] = useState(true);
  const [isValidToken, setIsValidToken] = useState(false);

  useEffect(() => {
    // Simulate token validation
    const timer = setTimeout(() => {
      setIsValidating(false);
      // Accept any token for now, or no token for testing if user just visits /booking
      // But requirement says "Read the token... Assume validation".
      // If token is present or we just want to allow testing:
      if (token) {
        setIsValidToken(true);
      } else {
        // For development ease, let's allow without token or show error
        // User said "Entry point is a Magic Link containing a token".
        // I'll show error if no token, to be "production-ready but minimal".
        setIsValidToken(false); 
      }
    }, 500);
    return () => clearTimeout(timer);
  }, [token]);

  const handleServiceSelect = (serviceId: string) => {
    setSelectedServiceId(serviceId);
  };

  const handleTimeSelect = (dateTime: { date: string; time: string }) => {
    setSelectedDateTime(dateTime);
  };

  const handleConfirm = () => {
    // Here we would submit to backend
    setIsConfirmed(true);
  };

  if (isValidating) {
    return (
      <BookingLayout>
        <div className="flex justify-center p-8">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-slate-900"></div>
        </div>
      </BookingLayout>
    );
  }

  if (!isValidToken) {
    return (
      <BookingLayout>
        <Card>
          <CardHeader>
            <CardTitle className="text-destructive">Geçersiz Bağlantı</CardTitle>
            <CardDescription>
              Randevu bağlantısı geçersiz veya süresi dolmuş. Lütfen yeni bir randevu bağlantısı isteyin.
            </CardDescription>
          </CardHeader>
        </Card>
      </BookingLayout>
    );
  }

  if (isConfirmed) {
    return (
      <BookingLayout>
        <Card className="border-green-500 bg-green-50">
          <CardHeader>
            <CardTitle className="text-green-700">Randevunuz Onaylandı!</CardTitle>
            <CardDescription className="text-green-600">
              Teşekkürler, randevunuz başarıyla oluşturuldu. Size bir onay mesajı gönderdik.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button 
              className="w-full bg-green-600 hover:bg-green-700 text-white"
              onClick={() => window.location.reload()}
            >
              Yeni Randevu Al
            </Button>
          </CardContent>
        </Card>
      </BookingLayout>
    );
  }

  return (
    <BookingLayout>
      <div className="mb-6">
        <div className="flex items-center justify-between text-sm text-slate-500 mb-2">
          <span>Adım {step} / 3</span>
          <span>
            {step === 1 && "Hizmet Seçimi"}
            {step === 2 && "Tarih & Saat"}
            {step === 3 && "Onay"}
          </span>
        </div>
        <div className="h-2 bg-slate-200 rounded-full">
          <div 
            className="h-full bg-slate-900 rounded-full transition-all duration-300"
            style={{ width: `${(step / 3) * 100}%` }}
          />
        </div>
      </div>

      {step === 1 && (
        <StepService 
          selectedServiceId={selectedServiceId}
          onSelect={handleServiceSelect}
          onNext={() => setStep(2)}
        />
      )}

      {step === 2 && (
        <StepTime 
          selectedDateTime={selectedDateTime}
          onSelect={handleTimeSelect}
          onBack={() => setStep(1)}
          onNext={() => setStep(3)}
        />
      )}

      {step === 3 && selectedServiceId && selectedDateTime && (
        <StepConfirm 
          selectedServiceId={selectedServiceId}
          selectedDateTime={selectedDateTime}
          onBack={() => setStep(2)}
          onConfirm={handleConfirm}
        />
      )}
    </BookingLayout>
  );
}
