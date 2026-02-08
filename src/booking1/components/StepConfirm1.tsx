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
        <div className="w-16 h-16 bg-emerald-50 text-emerald-500 rounded-full flex items-center justify-center mx-auto mb-4 border-4 border-emerald-100 shadow-inner">
          <CheckCircle2 className="w-8 h-8" />
        </div>
        <h2 className="text-2xl font-black text-slate-900">Neredeyse Bitti!</h2>
        <p className="text-sm text-slate-500 font-medium px-4">Randevu detaylarınızı kontrol edip onaylayın.</p>
      </div>

      <Card className="border-none shadow-xl rounded-[32px] overflow-hidden bg-white border border-slate-50">
        <div className="bg-slate-50/50 p-6 border-b border-slate-100">
          <h3 className="font-bold text-slate-900">Seçilen Hizmetler</h3>
        </div>
        <CardContent className="p-6 space-y-4">
          {selectedServices.map((s) => (
            <div key={s.id} className="flex justify-between items-start gap-4">
              <div className="flex items-start gap-3 flex-1 min-w-0">
                <div className="w-10 h-10 rounded-xl bg-amber-50 text-[#D4AF37] flex items-center justify-center shrink-0">
                  <Scissors className="w-5 h-5" />
                </div>
                <div className="min-w-0">
                  <p className="font-bold text-slate-900 truncate">{s.name}</p>
                  <p className="text-[11px] text-slate-500 font-bold">{s.duration} Dakika</p>
                </div>
              </div>
              <p className="font-black text-slate-900">{s.discountedPrice || s.price} ₺</p>
            </div>
          ))}

          <Separator className="my-4 bg-slate-100" />

          <div className="flex items-start gap-3">
            <div className="w-10 h-10 rounded-xl bg-blue-50 text-blue-500 flex items-center justify-center shrink-0">
              <Calendar className="w-5 h-5" />
            </div>
            <div>
              <p className="text-[11px] text-slate-400 font-black uppercase tracking-widest leading-none mb-1">Randevu Zamanı</p>
              <p className="font-bold text-slate-900">
                {new Date(selectedDateTime.date).toLocaleDateString('tr-TR', { day: 'numeric', month: 'long', year: 'numeric' })}
              </p>
              <div className="inline-flex items-center gap-1.5 mt-1 bg-slate-100 px-2 py-0.5 rounded-lg text-xs font-bold text-slate-600">
                <Clock className="w-3 h-3" />
                {selectedDateTime.time}
              </div>
            </div>
          </div>
        </CardContent>
        <div className="bg-[#D4AF37] p-6 text-white flex justify-between items-center shadow-inner">
          <span className="text-sm font-bold opacity-90">Toplam Tutar</span>
          <span className="text-3xl font-black">{totalPrice} ₺</span>
        </div>
      </Card>

      <div className="fixed bottom-0 left-0 right-0 p-6 bg-white/80 backdrop-blur-lg border-t border-slate-100 z-20 flex justify-between gap-4">
        <Button 
          variant="outline" 
          onClick={onBack} 
          className="flex-1 h-12 rounded-xl border-slate-200 text-slate-500 font-bold hover:bg-slate-50"
        >
          Geri Dön
        </Button>
        <Button 
          onClick={onConfirm} 
          className="flex-[2] h-12 rounded-xl bg-slate-900 hover:bg-slate-800 text-white font-bold shadow-xl active:scale-95 transition-all"
        >
          Randevuyu Onayla
        </Button>
      </div>
    </div>
  );
}
