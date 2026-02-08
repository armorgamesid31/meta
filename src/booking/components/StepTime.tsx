import React, { useState, useRef } from 'react';
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { Calendar, ChevronLeft, ChevronRight, Clock } from "lucide-react";

// Mock dates (Today + 14 days)
const generateDates = () => {
  const dates = [];
  const today = new Date();
  for (let i = 0; i < 14; i++) {
    const d = new Date(today);
    d.setDate(today.getDate() + i);
    dates.push({
      id: d.toISOString().split('T')[0],
      day: d.getDate(),
      dayName: d.toLocaleDateString('tr-TR', { weekday: 'short' }),
      fullDate: d.toISOString().split('T')[0],
      disabled: d.getDay() === 0 // Sunday disabled for example
    });
  }
  return dates;
};

const DATES = generateDates();

// Mock grouped times
const TIME_GROUPS = [
  {
    label: 'SABAH',
    times: ['09:00', '09:30', '10:00', '10:30', '11:00', '11:30']
  },
  {
    label: 'ÖĞLE',
    times: ['12:00', '12:30', '13:00', '13:30', '14:00', '14:30', '15:00', '15:30']
  },
  {
    label: 'AKŞAM',
    times: ['16:00', '16:30', '17:00', '17:30', '18:00', '18:30']
  }
];

interface StepTimeProps {
  selectedDateTime: { date: string; time: string } | null;
  onSelect: (dateTime: { date: string; time: string }) => void;
  onBack: () => void;
  onNext: () => void;
}

export function StepTime({ selectedDateTime, onSelect, onBack, onNext }: StepTimeProps) {
  const [selectedDateId, setSelectedDateId] = useState<string>(
    selectedDateTime?.date || DATES[0].fullDate
  );
  
  const scrollRef = useRef<HTMLDivElement>(null);

  const handleTimeClick = (time: string) => {
    onSelect({ date: selectedDateId, time });
  };

  const scroll = (direction: 'left' | 'right') => {
    if (scrollRef.current) {
      const scrollAmount = 200;
      scrollRef.current.scrollBy({
        left: direction === 'left' ? -scrollAmount : scrollAmount,
        behavior: 'smooth'
      });
    }
  };

  return (
    <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
      {/* Date Selection */}
      <div className="space-y-3">
        <div className="flex items-center gap-2 text-slate-900 font-medium">
          <Calendar className="h-5 w-5" />
          <h3>Tarih Seçin</h3>
        </div>
        
        <div className="relative group">
          <Button 
            variant="ghost" 
            size="icon" 
            className="absolute left-0 top-1/2 -translate-y-1/2 z-10 h-8 w-8 bg-white/80 shadow-sm backdrop-blur-sm opacity-0 group-hover:opacity-100 transition-opacity disabled:opacity-0"
            onClick={() => scroll('left')}
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>
          
          <div 
            ref={scrollRef}
            className="flex space-x-3 overflow-x-auto pb-4 pt-1 px-1 scrollbar-hide snap-x"
          >
            {DATES.map((d) => (
              <div 
                key={d.id}
                className="snap-start"
              >
                <button
                  disabled={d.disabled}
                  onClick={() => setSelectedDateId(d.fullDate)}
                  className={cn(
                    "flex flex-col items-center justify-center w-16 h-20 rounded-2xl border transition-all duration-200",
                    selectedDateId === d.fullDate 
                      ? "bg-slate-900 text-white border-slate-900 shadow-lg scale-105" 
                      : "bg-white text-slate-500 border-slate-200 hover:border-slate-300 hover:bg-slate-50",
                    d.disabled && "opacity-40 cursor-not-allowed bg-slate-50 border-slate-100"
                  )}
                >
                  <span className="text-xs font-medium uppercase">{d.dayName}</span>
                  <span className={cn("text-2xl font-bold", selectedDateId === d.fullDate ? "text-white" : "text-slate-900")}>
                    {d.day}
                  </span>
                  {d.disabled && <span className="text-[10px] mt-1">Dolu</span>}
                </button>
              </div>
            ))}
          </div>

          <Button 
            variant="ghost" 
            size="icon" 
            className="absolute right-0 top-1/2 -translate-y-1/2 z-10 h-8 w-8 bg-white/80 shadow-sm backdrop-blur-sm opacity-0 group-hover:opacity-100 transition-opacity"
            onClick={() => scroll('right')}
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {/* Time Selection */}
      <div className="space-y-4">
        <div className="flex items-center justify-between text-slate-900 font-medium">
          <div className="flex items-center gap-2">
            <Clock className="h-5 w-5" />
            <h3>Saat Seçin</h3>
          </div>
          <span className="text-xs font-normal text-slate-500 underline decoration-slate-300 underline-offset-4">~60 dakika</span>
        </div>

        <div className="space-y-6">
          {TIME_GROUPS.map((group) => (
            <div key={group.label} className="space-y-3">
              <h4 className="text-xs font-semibold text-slate-400 uppercase tracking-wider pl-1">{group.label}</h4>
              <div className="grid grid-cols-4 gap-3">
                {group.times.map((time) => {
                  const isSelected = selectedDateTime?.time === time && selectedDateTime?.date === selectedDateId;
                  
                  return (
                    <button
                      key={time}
                      onClick={() => handleTimeClick(time)}
                      className={cn(
                        "h-11 rounded-xl text-sm font-medium transition-all duration-200 border",
                        isSelected 
                          ? "bg-amber-600 text-white border-amber-600 shadow-md scale-105" 
                          : "bg-white text-slate-700 border-slate-200 hover:border-amber-200 hover:bg-amber-50"
                      )}
                    >
                      {time}
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="flex justify-between pt-6 sticky bottom-0 bg-gradient-to-t from-white via-white to-transparent pb-4">
        <Button variant="outline" onClick={onBack} size="lg">Geri</Button>
        <Button 
          onClick={onNext} 
          disabled={!selectedDateTime}
          size="lg"
          className="shadow-lg"
        >
          Devam Et
        </Button>
      </div>
    </div>
  );
}
