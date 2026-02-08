import React from 'react';
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";

// Mock services data (duplicated for simplicity in this context)
const SERVICES = [
  { id: '1', name: 'Saç Kesimi', duration: '30 dk', price: '150 TL' },
  { id: '2', name: 'Sakal Tıraşı', duration: '15 dk', price: '100 TL' },
  { id: '3', name: 'Saç & Sakal', duration: '45 dk', price: '220 TL' },
  { id: '4', name: 'Cilt Bakımı', duration: '60 dk', price: '300 TL' },
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
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Randevu Özeti</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex justify-between items-center">
            <span className="text-slate-500">Hizmet</span>
            <span className="font-medium">{service.name}</span>
          </div>
          <div className="flex justify-between items-center">
            <span className="text-slate-500">Süre</span>
            <span className="font-medium">{service.duration}</span>
          </div>
          <Separator />
          <div className="flex justify-between items-center">
            <span className="text-slate-500">Tarih</span>
            <span className="font-medium">{selectedDateTime.date.split('-').reverse().join('.')}</span>
          </div>
          <div className="flex justify-between items-center">
            <span className="text-slate-500">Saat</span>
            <span className="font-medium">{selectedDateTime.time}</span>
          </div>
          <Separator />
          <div className="flex justify-between items-center text-lg font-semibold">
            <span>Toplam</span>
            <span>{service.price}</span>
          </div>
        </CardContent>
      </Card>

      <div className="flex justify-between pt-4">
        <Button variant="outline" onClick={onBack}>Geri</Button>
        <Button onClick={onConfirm}>Randevuyu Onayla</Button>
      </div>
    </div>
  );
}
