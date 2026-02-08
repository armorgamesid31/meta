import React from 'react';
import { Button } from "../../components/ui/button";
import { Card, CardContent } from "../../components/ui/card";
import { Separator } from "../../components/ui/separator";
import { Calendar, Clock, CheckCircle2, Scissors, Zap } from "lucide-react";
import { Service } from "../BookingPage1";

interface StepConfirm1Props {
  selectedServices: Service[];
  selectedDateTime: { date: string; time: string };
  onBack: () => void;
  onConfirm: () => void;
}

export function StepConfirm1({ selectedServices, selectedDateTime, onBack, onConfirm }: StepConfirm1Props) {
  const totalPrice = selectedServices.reduce((sum, s) => sum + (s.discountedPrice || s.price), 0);

  return (
    <div className="space-y-6 pb-24 animate-in fade-in slide-in-from-right-4 duration-500">
      <div className="text-center space-y-2 mb-8">
        <div 
            className="rounded-full flex items-center justify-center mx-auto mb-4 border-4 border-emerald-100 shadow-inner"
            style={{ width: '64px', height: '64px', backgroundColor: '#ecfdf5', color: '#10b981' }}
        >
          <CheckCircle2 style={{ width: '32px', height: '32px' }} />
        </div>
        <h2 className="text-2xl font-black text-[#2D2D2D]">Neredeyse Bitti!</h2>
        <p className="text-sm text-slate-500 font-medium px-4">Randevu detaylarınızı kontrol edip onaylayın.</p>
      </div>

      <Card className="border-none shadow-[0px_4px_6px_-1px_rgba(0,0,0,0.1)] rounded-[32px] overflow-hidden bg-white border border-[#F3F4F6]">
        <div className="bg-[#F9FAFB] p-6 border-b border-[#F3F4F6]">
          <h3 className="font-bold text-[#2D2D2D]">Seçilen Hizmetler</h3>
        </div>
        <CardContent className="p-6 space-y-6">
          {selectedServices.map((s) => (
            <div key={s.id} className="flex justify-between items-start gap-4 w-full">
              <div className="flex items-start gap-3 flex-1 min-w-0">
                <div 
                    className="rounded-xl flex items-center justify-center shrink-0"
                    style={{ width: '40px', height: '40px', backgroundColor: '#fffbeb', color: '#D4AF37' }}
                >
                  <Scissors style={{ width: '20px', height: '20px' }} />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="font-bold text-[#2D2D2D] truncate">{s.name}</p>
                  <p className="text-[11px] text-slate-500 font-bold uppercase tracking-wider">{s.duration} Dakika</p>
                </div>
              </div>
              <p className="font-black text-[#2D2D2D] shrink-0 text-lg">{s.discountedPrice || s.price} ₺</p>
            </div>
          ))}

          <Separator className="my-2 bg-[#F3F4F6]" />

          <div className="flex items-start gap-4 w-full">
            <div 
                className="rounded-xl flex items-center justify-center shrink-0"
                style={{ width: '40px', height: '40px', backgroundColor: '#eff6ff', color: '#3b82f6' }}
            >
              <Calendar style={{ width: '20px', height: '20px' }} />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-[11px] text-slate-400 font-black uppercase tracking-widest leading-none mb-1.5">Randevu Zamanı</p>
              <p className="font-bold text-[#2D2D2D] text-base">
                {new Date(selectedDateTime.date).toLocaleDateString('tr-TR', { day: 'numeric', month: 'long', year: 'numeric' })}
              </p>
              <div className="inline-flex items-center gap-1.5 mt-2 bg-slate-50 border border-slate-100 px-3 py-1 rounded-lg text-xs font-bold text-slate-600 shadow-sm">
                <Clock style={{ width: '12px', height: '12px' }} />
                {selectedDateTime.time}
              </div>
            </div>
          </div>
        </CardContent>
        <div 
            className="p-6 text-white flex justify-between items-center shadow-[inset_0px_2px_4px_0px_rgba(0,0,0,0.1)]"
            style={{ backgroundColor: '#D4AF37' }}
        >
          <span className="text-sm font-bold opacity-90 uppercase tracking-widest">Toplam Tutar</span>
          <span className="text-3xl font-black">{totalPrice} ₺</span>
        </div>
      </Card>

      <div className="fixed bottom-0 left-0 right-0 p-4 bg-white/90 backdrop-blur-md border-t border-[#F3F4F6] z-30 flex justify-between gap-4">
        <Button 
          variant="outline" 
          onClick={onBack} 
          className="flex-1 h-12 rounded-[16px] border-[#F3F4F6] text-slate-500 font-bold hover:bg-slate-50 shadow-sm"
        >
          Geri Dön
        </Button>
        <Button 
          onClick={onConfirm} 
          className="flex-[2] h-12 rounded-[16px] bg-slate-900 hover:bg-slate-800 text-white font-bold shadow-xl active:scale-95 transition-all"
        >
          Randevuyu Onayla
        </Button>
      </div>
    </div>
  );
}
