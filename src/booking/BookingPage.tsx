import React, { useState, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { BookingLayout } from './BookingLayout.js';
import { StepService } from './components/StepService.js';
import { StepTime } from './components/StepTime.js';
import { StepConfirm } from './components/StepConfirm.js';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Sparkles, User } from "lucide-react";

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

  // Mock user data
  const USER_NAME = "Ayşe";

  useEffect(() => {
    // Simulate token validation
    const timer = setTimeout(() => {
      setIsValidating(false);
      // Accept any token for now, or no token for testing if user just visits /booking
      if (token || true) { // Always true for demo as requested "magic link looks like this" -> implying I should just show the UI
        setIsValidToken(true);
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
              Randevu bağlantısı geçersiz veya süresi dolmuş.
            </CardDescription>
          </CardHeader>
        </Card>
      </BookingLayout>
    );
  }

  if (isConfirmed) {
    return (
      <BookingLayout>
        <Card className="border-green-500 bg-green-50 shadow-lg">
          <CardHeader>
            <div className="mx-auto bg-green-100 p-3 rounded-full w-fit mb-4">
              <Sparkles className="h-6 w-6 text-green-600" />
            </div>
            <CardTitle className="text-green-700 text-center">Randevunuz Onaylandı!</CardTitle>
            <CardDescription className="text-green-600 text-center">
              Teşekkürler, randevunuz başarıyla oluşturuldu.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button 
              className="w-full bg-green-600 hover:bg-green-700 text-white shadow-md"
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
      {/* Header Section */}
      <div className="mb-6 space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-lg font-medium text-slate-500">Tekrar hoş geldin,</h2>
            <h1 className="text-2xl font-bold text-slate-900 flex items-center gap-2">
              {USER_NAME} <Sparkles className="h-5 w-5 text-amber-500 fill-amber-500" />
            </h1>
          </div>
          <div className="h-10 w-10 bg-slate-100 rounded-full flex items-center justify-center border border-slate-200">
            <User className="h-5 w-5 text-slate-600" />
          </div>
        </div>

        {/* Progress Steps (Subtle) */}
        <div className="flex items-center gap-2">
           {[1, 2, 3].map((s) => (
             <div 
               key={s}
               className={`h-1.5 flex-1 rounded-full transition-all duration-300 ${
                 s <= step ? 'bg-slate-900' : 'bg-slate-200'
               }`} 
             />
           ))}
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
