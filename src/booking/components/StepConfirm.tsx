import React from 'react';
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { Calendar, Clock, CheckCircle2, Scissors } from "lucide-react";

// Mock services data (duplicated for simplicity in this context)
const SERVICES = [
  { id: '1', name: 'Saç Kesimi', duration: '30 dk', price: '150 TL' },
  { id: '2', name: 'Sakal Tıraşı', duration: '15 dk', price: '100 TL' },
  { id: '3', name: 'Saç & Sakal', duration: '45 dk', price: '220 TL' },
  { id: '4', name: 'Cilt Bakımı', duration: '60 dk', price: '300 TL' },
  { id: 's1', name: 'Tüm Vücut Lazer', duration: '60 dk', price: '1500 TL' },
  { id: 's2', name: 'Kolaltı Lazer', duration: '15 dk', price: '300 TL' },
  { id: 's3', name: 'Klasik Cilt Bakımı', duration: '60 dk', price: '800 TL' },
  { id: 's4', name: 'Hydrafacial', duration: '45 dk', price: '1200 TL' },
  { id: 's5', name: 'Saç Kesimi', duration: '30 dk', price: '150 TL' },
  { id: 's6', name: 'Fön', duration: '15 dk', price: '100 TL' },
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
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <Card className="border-slate-200 shadow-md overflow-hidden">
        <div className="bg-slate-50 p-6 border-b border-slate-100 flex flex-col items-center gap-3">
            <div className="h-12 w-12 bg-white rounded-full flex items-center justify-center border border-slate-200 shadow-sm text-slate-900">
                <CheckCircle2 className="h-6 w-6" />
            </div>
            <div className="text-center">
                <h3 className="text-lg font-semibold text-slate-900">Randevu Özeti</h3>
                <p className="text-sm text-slate-500">Lütfen bilgileri kontrol ediniz</p>
            </div>
        </div>
        <CardContent className="p-6 space-y-6">
          
          {/* Service Info */}
          <div className="flex items-start gap-4">
            <div className="h-10 w-10 rounded-lg bg-orange-50 flex items-center justify-center text-orange-600 shrink-0">
                <Scissors className="h-5 w-5" />
            </div>
            <div className="flex-1 space-y-1">
                <p className="text-xs font-medium text-slate-500 uppercase tracking-wider">HİZMET</p>
                <p className="font-semibold text-slate-900">{service.name}</p>
                <p className="text-sm text-slate-500">{service.duration}</p>
            </div>
            <div className="text-right">
                <p className="font-bold text-slate-900">{service.price}</p>
            </div>
          </div>

          <Separator />

          {/* Date & Time Info */}
          <div className="flex items-start gap-4">
             <div className="h-10 w-10 rounded-lg bg-blue-50 flex items-center justify-center text-blue-600 shrink-0">
                <Calendar className="h-5 w-5" />
            </div>
            <div className="flex-1 space-y-1">
                <p className="text-xs font-medium text-slate-500 uppercase tracking-wider">TARİH & SAAT</p>
                <p className="font-semibold text-slate-900">
                    {new Date(selectedDateTime.date).toLocaleDateString('tr-TR', { day: 'numeric', month: 'long', year: 'numeric' })}
                </p>
                <div className="flex items-center gap-1.5 text-sm text-slate-700 font-medium">
                    <Clock className="h-3.5 w-3.5" />
                    {selectedDateTime.time}
                </div>
            </div>
          </div>
        </CardContent>
        <div className="bg-slate-50 p-4 border-t border-slate-100 flex justify-between items-center">
            <span className="text-sm font-medium text-slate-600">Toplam Tutar</span>
            <span className="text-xl font-bold text-slate-900">{service.price}</span>
        </div>
      </Card>

      <div className="flex justify-between pt-4 sticky bottom-0 bg-gradient-to-t from-white via-white to-transparent pb-4">
        <Button variant="outline" onClick={onBack} size="lg">Geri</Button>
        <Button 
            onClick={onConfirm} 
            size="lg"
            className="shadow-lg bg-slate-900 hover:bg-slate-800"
        >
            Randevuyu Onayla
        </Button>
      </div>
    </div>
  );
}
