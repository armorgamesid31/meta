import React from 'react';
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { Calendar, Clock, CheckCircle2, Scissors, Zap } from "lucide-react";

// Mock services data (duplicated for simplicity in this context)
const SERVICES = [
  { id: '1', name: 'Saç Kesimi', duration: '30 dk', price: '150 TL' },
  { id: '2', name: 'Sakal Tıraşı', duration: '15 dk', price: '100 TL' },
  { id: '3', name: 'Saç & Sakal', duration: '45 dk', price: '220 TL' },
  { id: '4', name: 'Cilt Bakımı', duration: '60 dk', price: '300 TL' },
  { id: 's1', name: 'Tam Vücut Lazer Paketi', duration: '60 dk', price: '1650 TL', badge: 'Fast Track' },
  { id: 's2', name: 'Sırt Lazer', duration: '30 dk', price: '1100 TL' },
  { id: 's2b', name: 'Bacak Lazer', duration: '45 dk', price: '1500 TL' },
  { id: 's2c', name: 'Sir Ağda', duration: '20 dk', price: '400 TL' },
  { id: 's3', name: 'Klasik Cilt Bakımı', duration: '60 dk', price: '800 TL' },
  { id: 's4', name: 'Hydrafacial', duration: '45 dk', price: '1200 TL' },
];

interface StepConfirmProps {
  selectedServiceId: string;
  selectedDateTime: { date: string; time: string };
  onBack: () => void;
  onConfirm: () => void;
}

export function StepConfirm({ selectedServiceId, selectedDateTime, onBack, onConfirm }: StepConfirmProps) {
  const service = SERVICES.find(s => s.id === selectedServiceId);

  if (!service) return <div>Hata: Hizmet bulunamadı.</div>;

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500 pb-20">
      <Card className="border-none shadow-xl rounded-3xl overflow-hidden bg-white">
        <div className="bg-amber-50 p-8 border-b border-amber-100 flex flex-col items-center gap-4">
            <div className="h-16 w-16 bg-white rounded-full flex items-center justify-center border-4 border-amber-100 shadow-sm text-amber-500">
                <CheckCircle2 className="h-8 w-8" />
            </div>
            <div className="text-center space-y-1">
                <h3 className="text-xl font-bold text-slate-900">Randevu Özeti</h3>
                <p className="text-slate-500 font-medium">Lütfen bilgileri kontrol ediniz</p>
            </div>
        </div>
        <CardContent className="p-8 space-y-8">
          
          {/* Service Info */}
          <div className="flex items-start gap-5">
            <div className="h-12 w-12 rounded-2xl bg-amber-100 flex items-center justify-center text-amber-600 shrink-0 shadow-inner">
                <Scissors className="h-6 w-6" />
            </div>
            <div className="flex-1 space-y-2">
                <p className="text-xs font-bold text-slate-400 uppercase tracking-widest">HİZMET</p>
                <div>
                    <p className="font-bold text-slate-900 text-lg leading-tight">{service.name}</p>
                    {service.badge && (
                        <span className="inline-flex items-center gap-1 bg-amber-100 text-amber-700 text-[10px] font-bold px-2 py-0.5 rounded-full mt-1">
                            <Zap className="h-3 w-3" />
                            {service.badge}
                        </span>
                    )}
                </div>
                <p className="text-sm text-slate-500 font-medium">{service.duration}</p>
            </div>
            <div className="text-right">
                <p className="font-black text-slate-900 text-xl">{service.price}</p>
            </div>
          </div>

          <Separator className="bg-slate-100" />

          {/* Date & Time Info */}
          <div className="flex items-start gap-5">
             <div className="h-12 w-12 rounded-2xl bg-blue-50 flex items-center justify-center text-blue-600 shrink-0 shadow-inner">
                <Calendar className="h-6 w-6" />
            </div>
            <div className="flex-1 space-y-2">
                <p className="text-xs font-bold text-slate-400 uppercase tracking-widest">TARİH & SAAT</p>
                <p className="font-bold text-slate-900 text-lg">
                    {new Date(selectedDateTime.date).toLocaleDateString('tr-TR', { day: 'numeric', month: 'long', year: 'numeric' })}
                </p>
                <div className="flex items-center gap-2 text-slate-600 font-semibold bg-slate-50 px-3 py-1.5 rounded-lg w-fit">
                    <Clock className="h-4 w-4" />
                    {selectedDateTime.time}
                </div>
            </div>
          </div>
        </CardContent>
        <div className="bg-slate-50 p-6 border-t border-slate-100 flex justify-between items-center">
            <span className="text-base font-bold text-slate-500">Toplam Tutar</span>
            <span className="text-3xl font-black text-emerald-600">{service.price}</span>
        </div>
      </Card>

      <div className="fixed bottom-0 left-0 right-0 p-4 bg-white border-t border-slate-100 shadow-[0_-4px_20px_-5px_rgba(0,0,0,0.1)] z-20 flex justify-between gap-4">
        <Button 
            variant="outline" 
            onClick={onBack} 
            size="lg"
            className="flex-1 h-14 rounded-xl border-2 border-slate-200 text-slate-600 font-bold text-lg hover:bg-slate-50 hover:border-slate-300"
        >
            Geri
        </Button>
        <Button 
            onClick={onConfirm} 
            size="lg"
            className="flex-[2] h-14 rounded-xl bg-amber-500 hover:bg-amber-600 text-white font-bold text-lg shadow-xl shadow-amber-200"
        >
            Randevuyu Onayla
        </Button>
      </div>
    </div>
  );
}
