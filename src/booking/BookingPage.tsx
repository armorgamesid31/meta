import React, { useState, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { BookingLayout } from './BookingLayout';
import { StepService } from './components/StepService';
import { StepTime } from './components/StepTime';
import { StepConfirm } from './components/StepConfirm';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../components/ui/card";
import { Button } from "../components/ui/button";
import { Sparkles, User, Gift, Users } from "lucide-react";

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
      if (token || true) { 
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
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-yellow-500"></div>
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
        <Card className="border-green-500 bg-green-50 shadow-lg rounded-2xl overflow-hidden">
          <CardHeader>
            <div className="mx-auto bg-green-100 p-4 rounded-full w-fit mb-4">
              <Sparkles className="h-8 w-8 text-green-600 fill-green-600" />
            </div>
            <CardTitle className="text-green-700 text-center text-xl">Randevunuz Onaylandı!</CardTitle>
            <CardDescription className="text-green-600 text-center">
              Teşekkürler, randevunuz başarıyla oluşturuldu.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button 
              className="w-full bg-green-600 hover:bg-green-700 text-white shadow-md rounded-xl h-12 text-lg"
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
      <div className="mb-6 space-y-6 bg-white -mx-4 px-4 pt-6 pb-4 border-b border-slate-100">
        {/* Top Bar */}
        <div className="flex items-center justify-between">
            <div className="flex items-center gap-3 min-w-0">
                <div className="bg-yellow-50/50 border border-yellow-200 rounded-2xl w-12 h-12 flex items-center justify-center shrink-0">
                    <Sparkles className="h-6 w-6 text-yellow-600 fill-yellow-600" />
                </div>
                <h1 className="text-xl font-bold text-slate-900 tracking-tight truncate">SalonAsistan</h1>
            </div>
            <div className="relative shrink-0 ml-4">
                <div className="w-12 h-12 bg-slate-100 rounded-full flex items-center justify-center border-2 border-white shadow-sm overflow-hidden">
                    <img src="https://api.dicebear.com/7.x/avataaars/svg?seed=Ayse" alt="User" className="w-full h-full object-cover block" />
                </div>
                <div className="absolute bottom-0 right-0 h-3.5 w-3.5 bg-green-500 border-2 border-white rounded-full"></div>
            </div>
        </div>

        {/* Welcome Message */}
        <div>
            <h2 className="text-xl text-slate-900 font-medium">Tekrar hoş geldin, {USER_NAME} ✨</h2>
        </div>
      </div>

      <div className="space-y-6">
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
      </div>
    </BookingLayout>
  );
}
