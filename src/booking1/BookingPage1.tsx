import React, { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { BookingLayout1 } from './BookingLayout1';
import { StepService1 } from './components/StepService1';
import { StepTime1 } from './components/StepTime1';
import { StepConfirm1 } from './components/StepConfirm1';
import { Sparkles, User, CheckCircle2 } from "lucide-react";
import { Button } from "../components/ui/button";
import { Card } from "../components/ui/card";

export interface Service {
  id: number;
  name: string;
  duration: number;
  price: number;
  discountedPrice?: number;
  icon?: string;
  category?: string;
}

export function BookingPage1() {
  const [searchParams] = useSearchParams();
  const token = searchParams.get('token');
  
  const [step, setStep] = useState(1);
  const [selectedServices, setSelectedServices] = useState<Service[]>([]);
  const [selectedDateTime, setSelectedDateTime] = useState<{ date: string; time: string } | null>(null);
  const [isConfirmed, setIsConfirmed] = useState(false);

  // Mock user data
  const USER_NAME = "Ayşe";

  const toggleService = (service: Service) => {
    setSelectedServices(prev => 
      prev.find(s => s.id === service.id)
        ? prev.filter(s => s.id !== service.id)
        : [...prev, service]
    );
  };

  const totalPrice = selectedServices.reduce((sum, s) => sum + (s.discountedPrice || s.price), 0);

  if (isConfirmed) {
    return (
      <BookingLayout1>
        <div className="flex-1 flex flex-col items-center justify-center p-8 text-center space-y-6 animate-in zoom-in-95 duration-500">
          <div className="w-24 h-24 bg-emerald-50 text-emerald-500 rounded-full flex items-center justify-center border-8 border-emerald-100 shadow-xl relative shrink-0">
             <CheckCircle2 className="w-12 h-12" />
             <div className="absolute inset-0 rounded-full animate-ping bg-emerald-200 opacity-20"></div>
          </div>
          <div className="space-y-2">
            <h2 className="text-3xl font-black text-[#2D2D2D]">Harika!</h2>
            <p className="text-slate-500 font-bold text-lg">Randevunuz başarıyla oluşturuldu.</p>
          </div>
          <Card className="w-full bg-slate-50 border-none rounded-3xl p-6 shadow-none">
            <p className="text-sm text-slate-600 font-medium leading-relaxed text-center">Randevu detaylarınız onaylandı ve takviminize eklendi. Bilgilendirme mesajı telefonunuza iletildi.</p>
          </Card>
          <Button 
            onClick={() => window.location.reload()}
            className="w-full h-14 rounded-2xl bg-slate-900 hover:bg-slate-800 text-white font-black text-lg shadow-xl transition-all active:scale-95"
          >
            Ana Sayfaya Dön
          </Button>
        </div>
      </BookingLayout1>
    );
  }

  return (
    <BookingLayout1>
      {/* Header - Robust styling */}
      <header className="sticky top-0 z-20 bg-white border-b border-[#F3F4F6] px-4 pt-6 pb-4 space-y-4">
        <div className="flex items-center justify-between w-full">
          <div className="flex items-center gap-3 min-w-0 flex-1">
            <div 
                className="rounded-[16px] flex items-center justify-center shrink-0 shadow-sm"
                style={{ 
                    width: '44px', 
                    height: '44px',
                    background: 'linear-gradient(180deg, rgba(212, 175, 55, 1) 0%, rgba(184, 148, 31, 1) 100%)' 
                }}
            >
              <Sparkles className="text-white fill-white" style={{ width: '24px', height: '24px' }} />
            </div>
            <h1 className="text-2xl font-bold text-[#2D2D2D] tracking-tight truncate">SalonAsistan</h1>
          </div>
          <div className="shrink-0 ml-4">
            <div className="relative" style={{ width: '48px', height: '48px' }}>
                <div className="bg-[#D4AF37]/10 rounded-full border-2 border-white shadow-sm overflow-hidden flex items-center justify-center w-full h-full">
                <img 
                    src={`https://api.dicebear.com/7.x/avataaars/svg?seed=${USER_NAME}`} 
                    alt="User" 
                    className="object-cover block" 
                    style={{ width: '48px', height: '48px', maxWidth: '48px', minWidth: '48px' }}
                />
                </div>
                <div 
                    className="absolute bottom-0 right-0 bg-[#10B981] border-2 border-white rounded-full"
                    style={{ width: '14px', height: '14px' }}
                ></div>
            </div>
          </div>
        </div>
        
        {step === 1 && (
          <div className="animate-in fade-in slide-in-from-top-2 duration-500 pt-2">
            <h2 className="text-[18px] font-normal text-[#2D2D2D] leading-tight">
              Tekrar hoş geldin, <span className="font-bold">{USER_NAME} ✨</span>
            </h2>
          </div>
        )}

        {/* Progress Dots */}
        <div className="flex gap-1.5 pt-2">
          {[1, 2, 3].map((i) => (
            <div 
              key={i} 
              className="h-1 rounded-full transition-all duration-300"
              style={{ 
                width: step === i ? '32px' : '8px',
                backgroundColor: step === i ? '#D4AF37' : '#F3F4F6'
              }}
            />
          ))}
        </div>
      </header>

      {/* Main Content Area */}
      <div className="flex-1 px-4 py-6 overflow-x-hidden">
        {step === 1 && (
          <StepService1 
            selectedServices={selectedServices}
            onToggleService={toggleService}
            onNext={() => setStep(2)}
          />
        )}

        {step === 2 && (
          <StepTime1 
            selectedDateTime={selectedDateTime}
            onSelect={setSelectedDateTime}
            onBack={() => setStep(1)}
            onNext={() => setStep(3)}
          />
        )}

        {step === 3 && (
          <StepConfirm1 
            selectedServices={selectedServices}
            selectedDateTime={selectedDateTime!}
            onBack={() => setStep(2)}
            onConfirm={() => setIsConfirmed(true)}
          />
        )}
      </div>

      {/* Sticky Bottom Summary for Step 1 */}
      {step === 1 && selectedServices.length > 0 && (
        <div className="sticky bottom-0 p-4 bg-white/90 backdrop-blur-md border-t border-[#F3F4F6] animate-in slide-in-from-bottom-full duration-300 z-30">
          <div className="flex items-center justify-between gap-4 w-full">
            <div className="flex flex-col min-w-0">
              <span className="text-[11px] text-slate-400 font-bold uppercase tracking-wider leading-none mb-1 truncate">{selectedServices.length} Hizmet seçildi</span>
              <span className="text-2xl font-black text-[#2D2D2D] truncate">{totalPrice} ₺</span>
            </div>
            <Button 
              onClick={() => setStep(2)}
              className="bg-[#D4AF37] hover:bg-[#B8941F] text-white rounded-[16px] px-8 h-12 font-bold shadow-lg shadow-[#D4AF37]/20 active:scale-95 transition-all"
            >
              Devam Et
            </Button>
          </div>
        </div>
      )}
    </BookingLayout1>
  );
}
