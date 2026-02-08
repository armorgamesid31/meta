import React, { useState, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { BookingLayout } from './BookingLayout.js';
import { StepService } from './components/StepService.js';
import { StepTime } from './components/StepTime.js';
import { StepConfirm } from './components/StepConfirm.js';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
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
    // Auto advance for better UX or stay? The screenshot has "Ekle" buttons, implying adding to cart.
    // For simplicity, let's assume single selection and manual advance or auto advance.
    // User wants "Ekle" buttons. Let's make "Devam Et" separate.
    // So select just updates state.
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
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-amber-500"></div>
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
      <div className="mb-6 space-y-4">
        {/* Top Bar */}
        <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 min-w-0">
                <div className="bg-amber-500 rounded-lg p-1.5 shadow-sm shrink-0">
                    <Sparkles className="h-5 w-5 text-white fill-white" />
                </div>
                <h1 className="text-xl font-bold text-slate-900 tracking-tight truncate">SalonAsistan</h1>
            </div>
            <div className="relative shrink-0 ml-4">
                <div className="h-10 w-10 bg-amber-100 rounded-full flex items-center justify-center border-2 border-white shadow-sm overflow-hidden">
                    {/* Placeholder avatar or icon */}
                    <img src="https://api.dicebear.com/7.x/avataaars/svg?seed=Ayse" alt="User" className="h-full w-full object-cover" />
                </div>
                <div className="absolute -bottom-1 -right-1 h-4 w-4 bg-green-500 border-2 border-white rounded-full"></div>
            </div>
        </div>

        {/* Welcome Message */}
        <div>
            <h2 className="text-lg text-slate-600 font-medium">Tekrar hoş geldin, {USER_NAME} <span className="inline-block animate-pulse">✨</span></h2>
        </div>

        {/* Promo Banner */}
        {step === 1 && (
            <div className="bg-white border-2 border-amber-400/30 rounded-2xl p-4 shadow-sm relative overflow-hidden">
                <div className="absolute top-0 right-0 p-2 opacity-10">
                    <Users className="h-24 w-24" />
                </div>
                <div className="flex items-start gap-4 relative z-10">
                    <div className="bg-amber-100 p-3 rounded-full shrink-0 text-amber-600">
                        <Users className="h-6 w-6" />
                    </div>
                    <div className="space-y-1 flex-1">
                        <h3 className="font-bold text-slate-900 leading-tight">Randevuna arkadaşını ekle, anında 100 TL kazan!</h3>
                        <p className="text-xs text-slate-500 font-medium">Hem sen hem de arkadaşın indirim kazanın</p>
                    </div>
                    <div className="flex items-center">
                        {/* Mock Switch since I don't have it installed */}
                         <div className="w-11 h-6 bg-slate-200 rounded-full relative cursor-pointer">
                            <div className="absolute left-1 top-1 w-4 h-4 bg-white rounded-full shadow-sm transition-transform"></div>
                         </div>
                    </div>
                </div>
            </div>
        )}
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
