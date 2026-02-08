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
          <div className="w-24 h-24 bg-emerald-50 text-emerald-500 rounded-full flex items-center justify-center border-8 border-emerald-100 shadow-xl relative">
             <CheckCircle2 className="w-12 h-12" />
             <div className="absolute inset-0 rounded-full animate-ping bg-emerald-200 opacity-20"></div>
          </div>
          <div className="space-y-2">
            <h2 className="text-3xl font-black text-slate-900">Harika!</h2>
            <p className="text-slate-500 font-bold text-lg">Randevunuz başarıyla oluşturuldu.</p>
          </div>
          <Card className="w-full bg-slate-50 border-none rounded-3xl p-6 shadow-none">
            <p className="text-sm text-slate-600 font-medium leading-relaxed">Randevu detaylarınız onaylandı ve takviminize eklendi. Bilgilendirme mesajı telefonunuza iletildi.</p>
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
      {/* Header - Fixed like Figma */}
      <header className="sticky top-0 z-20 bg-white border-b border-slate-100 px-6 py-4 space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-11 h-11 bg-[#D4AF37]/10 border border-[#D4AF37]/30 rounded-xl flex items-center justify-center">
              <Sparkles className="w-6 h-6 text-[#D4AF37] fill-[#D4AF37]" />
            </div>
            <h1 className="text-xl font-bold text-slate-900 tracking-tight">SalonAsistan</h1>
          </div>
          <div className="relative">
            <div className="w-11 h-11 bg-slate-100 rounded-full border-2 border-white shadow-sm overflow-hidden flex items-center justify-center">
              <img src={`https://api.dicebear.com/7.x/avataaars/svg?seed=${USER_NAME}`} alt="User" className="w-full h-full object-cover" />
            </div>
            <div className="absolute bottom-0 right-0 w-3.5 h-3.5 bg-green-500 border-2 border-white rounded-full"></div>
          </div>
        </div>
        
        {step === 1 && (
          <div className="animate-in fade-in slide-in-from-top-2 duration-500">
            <h2 className="text-[22px] font-semibold text-slate-900 leading-tight">
              Tekrar hoş geldin, {USER_NAME} ✨
            </h2>
          </div>
        )}

        {/* Progress Dots */}
        <div className="flex gap-1.5 pt-2">
          {[1, 2, 3].map((i) => (
            <div 
              key={i} 
              className={`h-1.5 rounded-full transition-all duration-300 ${
                step === i ? 'w-8 bg-[#D4AF37]' : 'w-2 bg-slate-200'
              }`}
            />
          ))}
        </div>
      </header>

      {/* Main Content Area */}
      <div className="flex-1 px-6 py-6">
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
        <div className="sticky bottom-0 p-6 bg-white/80 backdrop-blur-lg border-t border-slate-100 animate-in slide-in-from-bottom-full duration-300">
          <div className="flex items-center justify-between mb-2">
            <div className="flex flex-col">
              <span className="text-xs text-slate-500 font-bold uppercase tracking-tight">{selectedServices.length} Hizmet seçildi</span>
              <span className="text-2xl font-black text-slate-900">{totalPrice} ₺</span>
            </div>
            <Button 
              onClick={() => setStep(2)}
              className="bg-[#D4AF37] hover:bg-[#B8941F] text-white rounded-2xl px-10 h-14 font-black text-lg shadow-xl shadow-[#D4AF37]/20 active:scale-95 transition-all"
            >
              Devam Et
            </Button>
          </div>
        </div>
      )}
    </BookingLayout1>
  );
}
