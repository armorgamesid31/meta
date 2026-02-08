import React from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Check } from "lucide-react";
import { cn } from "@/lib/utils";

// Mock services data
const SERVICES = [
  { id: '1', name: 'Saç Kesimi', duration: '30 dk', price: '150 TL' },
  { id: '2', name: 'Sakal Tıraşı', duration: '15 dk', price: '100 TL' },
  { id: '3', name: 'Saç & Sakal', duration: '45 dk', price: '220 TL' },
  { id: '4', name: 'Cilt Bakımı', duration: '60 dk', price: '300 TL' },
];

interface StepServiceProps {
  selectedServiceId: string | null;
  onSelect: (serviceId: string) => void;
  onNext: () => void;
}

export function StepService({ selectedServiceId, onSelect, onNext }: StepServiceProps) {
  return (
    <div className="space-y-4">
      <div className="grid gap-4">
        {SERVICES.map((service) => (
          <Card 
            key={service.id}
            className={cn(
              "cursor-pointer transition-all hover:border-slate-400",
              selectedServiceId === service.id ? "border-slate-900 bg-slate-50 ring-1 ring-slate-900" : ""
            )}
            onClick={() => onSelect(service.id)}
          >
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-base font-semibold">{service.name}</CardTitle>
              {selectedServiceId === service.id && <Check className="h-4 w-4 text-slate-900" />}
            </CardHeader>
            <CardContent>
              <CardDescription className="flex justify-between items-center mt-2">
                <span>{service.duration}</span>
                <span className="font-medium text-slate-900">{service.price}</span>
              </CardDescription>
            </CardContent>
          </Card>
        ))}
      </div>
      
      <div className="flex justify-end pt-4">
        <Button 
          onClick={onNext} 
          disabled={!selectedServiceId}
          className="w-full sm:w-auto"
        >
          Devam Et
        </Button>
      </div>
    </div>
  );
}
