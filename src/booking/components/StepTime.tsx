import React, { useState, useRef } from 'react';
import { Button } from "../../components/ui/button";
import { cn } from "../../lib/utils";
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
    <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500 pb-20">
      {/* Date Selection */}
      <div className="space-y-4">
        <div className="flex items-center gap-2 text-yellow-600 font-bold text-lg px-2">
          <Calendar className="h-6 w-6" />
          <h3>Tarih Seçin</h3>
        </div>
        
        <div className="relative group">
          <div 
            ref={scrollRef}
            className="flex space-x-3 overflow-x-auto pb-4 pt-1 px-2 scrollbar-hide snap-x"
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
                    "flex flex-col items-center justify-center w-20 h-24 rounded-3xl border-2 transition-all duration-300",
                    selectedDateId === d.fullDate 
                      ? "bg-yellow-500 text-white border-yellow-500 shadow-xl scale-110 z-10" 
                      : "bg-white text-slate-500 border-transparent shadow-sm hover:border-yellow-200 hover:bg-yellow-50",
                    d.disabled && "opacity-40 cursor-not-allowed bg-slate-50 border-transparent shadow-none"
                  )}
                >
                  <span className={cn("text-xs font-medium uppercase mb-1", selectedDateId === d.fullDate ? "text-yellow-100" : "text-slate-400")}>
                      {d.dayName}
                  </span>
                  <span className={cn("text-3xl font-black", selectedDateId === d.fullDate ? "text-white" : "text-slate-800")}>
                    {d.day}
                  </span>
                  {d.disabled && <span className="text-[10px] mt-1">Dolu</span>}
                </button>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Time Selection */}
      <div className="space-y-6 px-2">
        <div className="flex items-center justify-between text-yellow-600 font-bold text-lg">
          <div className="flex items-center gap-2">
            <Clock className="h-6 w-6" />
            <h3>Saat Seçin</h3>
          </div>
          <span className="text-xs font-medium text-slate-400 bg-slate-100 px-3 py-1 rounded-full">~60 dakika</span>
        </div>

        <div className="space-y-8">
          {TIME_GROUPS.map((group) => (
            <div key={group.label} className="space-y-3">
              <h4 className="text-xs font-bold text-slate-400 uppercase tracking-wider pl-1">{group.label}</h4>
              <div className="grid grid-cols-4 gap-3">
                {group.times.map((time) => {
                  const isSelected = selectedDateTime?.time === time && selectedDateTime?.date === selectedDateId;
                  
                  return (
                    <button
                      key={time}
                      onClick={() => handleTimeClick(time)}
                      className={cn(
                        "h-12 rounded-2xl text-sm font-bold transition-all duration-200 border-2",
                        isSelected 
                          ? "bg-yellow-500 text-white border-yellow-500 shadow-lg scale-105" 
                          : "bg-white text-slate-700 border-slate-100 shadow-sm hover:border-yellow-300 hover:bg-yellow-50 hover:text-yellow-700"
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
          onClick={onNext} 
          disabled={!selectedDateTime}
          size="lg"
          className="flex-[2] h-14 rounded-xl bg-slate-900 hover:bg-slate-800 text-white font-bold text-lg shadow-xl"
        >
          Devam Et
        </Button>
      </div>
    </div>
  );
}
