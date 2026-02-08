import React, { useState } from 'react';
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";

// Mock dates (Today, Tomorrow, Day After)
const DATES = [
  { id: 'today', label: 'Bugün', date: '2024-02-08' },
  { id: 'tomorrow', label: 'Yarın', date: '2024-02-09' },
  { id: 'dayafter', label: 'Pazar', date: '2024-02-10' },
];

// Mock times
const TIMES = [
  '09:00', '09:30', '10:00', '10:30', '11:00', '11:30',
  '13:00', '13:30', '14:00', '14:30', '15:00', '15:30',
  '16:00', '16:30', '17:00'
];

interface StepTimeProps {
  selectedDateTime: { date: string; time: string } | null;
  onSelect: (dateTime: { date: string; time: string }) => void;
  onBack: () => void;
  onNext: () => void;
}

export function StepTime({ selectedDateTime, onSelect, onBack, onNext }: StepTimeProps) {
  const [selectedDateId, setSelectedDateId] = useState<string>(
    selectedDateTime ? DATES.find(d => d.date === selectedDateTime.date)?.id || 'today' : 'today'
  );

  const handleTimeClick = (time: string) => {
    const dateObj = DATES.find(d => d.id === selectedDateId);
    if (dateObj) {
      onSelect({ date: dateObj.date, time });
    }
  };

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <h3 className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70">Tarih Seçin</h3>
        <div className="flex space-x-2 overflow-x-auto pb-2">
          {DATES.map((d) => (
            <Button
              key={d.id}
              variant={selectedDateId === d.id ? "default" : "outline"}
              className="min-w-[100px]"
              onClick={() => setSelectedDateId(d.id)}
            >
              <div className="flex flex-col items-center">
                <span className="text-xs font-normal">{d.label}</span>
                <span>{d.date.split('-').slice(1).reverse().join('.')}</span>
              </div>
            </Button>
          ))}
        </div>
      </div>

      <div className="space-y-2">
        <h3 className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70">Saat Seçin</h3>
        <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
          {TIMES.map((time) => {
            const isSelected = selectedDateTime?.time === time && 
                               selectedDateTime?.date === DATES.find(d => d.id === selectedDateId)?.date;
            
            return (
              <Button
                key={time}
                variant={isSelected ? "default" : "outline"}
                className={cn(
                  "h-10",
                  isSelected ? "bg-slate-900 text-slate-50 hover:bg-slate-900/90" : ""
                )}
                onClick={() => handleTimeClick(time)}
              >
                {time}
              </Button>
            );
          })}
        </div>
      </div>

      <div className="flex justify-between pt-4">
        <Button variant="outline" onClick={onBack}>Geri</Button>
        <Button 
          onClick={onNext} 
          disabled={!selectedDateTime}
        >
          Devam Et
        </Button>
      </div>
    </div>
  );
}
