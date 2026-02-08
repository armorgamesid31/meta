import React, { useState, useRef } from 'react';
import { Button } from "../../components/ui/button";
import { cn } from "../../lib/utils";
import { Calendar, Clock, ChevronLeft, ChevronRight } from "lucide-react";

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
      disabled: d.getDay() === 0
    });
  }
  return dates;
};

const DATES = generateDates();

const TIME_GROUPS = [
  { label: 'Sabah', times: ['09:00', '09:30', '10:00', '10:30', '11:00', '11:30'] },
  { label: 'Öğle', times: ['12:00', '12:30', '13:00', '13:30', '14:00', '14:30', '15:00', '15:30'] },
  { label: 'Akşam', times: ['16:00', '16:30', '17:00', '17:30', '18:00', '18:30'] }
];

interface StepTime1Props {
  selectedDateTime: { date: string; time: string } | null;
  onSelect: (dateTime: { date: string; time: string }) => void;
  onBack: () => void;
  onNext: () => void;
}

export function StepTime1({ selectedDateTime, onSelect, onBack, onNext }: StepTime1Props) {
  const [selectedDateId, setSelectedDateId] = useState<string>(
    selectedDateTime?.date || DATES[0].fullDate
  );
  
  const scrollRef = useRef<HTMLDivElement>(null);

  const handleTimeClick = (time: string) => {
    onSelect({ date: selectedDateId, time });
  };

  const scroll = (direction: 'left' | 'right') => {
    if (scrollRef.current) {
      scrollRef.current.scrollBy({ left: direction === 'left' ? -200 : 200, behavior: 'smooth' });
    }
  };

  return (
    <div className="space-y-8 pb-24 animate-in fade-in slide-in-from-right-4 duration-500">
      {/* Date Selection */}
      <div className="space-y-4">
        <div className="flex items-center justify-between px-1">
          <div className="flex items-center gap-2 text-[#2D2D2D] font-bold">
            <Calendar style={{ width: '20px', height: '20px', color: '#D4AF37' }} />
            <h3 className="text-lg">Tarih Seçin</h3>
          </div>
          <div className="flex gap-1">
            <Button variant="ghost" size="icon" className="h-8 w-8 rounded-full" onClick={() => scroll('left')}>
              <ChevronLeft style={{ width: '16px', height: '16px' }} />
            </Button>
            <Button variant="ghost" size="icon" className="h-8 w-8 rounded-full" onClick={() => scroll('right')}>
              <ChevronRight style={{ width: '16px', height: '16px' }} />
            </Button>
          </div>
        </div>
        
        <div 
          ref={scrollRef}
          className="flex gap-3 overflow-x-auto pb-4 pt-1 px-1 scrollbar-hide snap-x"
        >
          {DATES.map((d) => (
            <button
              key={d.id}
              disabled={d.disabled}
              onClick={() => setSelectedDateId(d.fullDate)}
              className={cn(
                "flex flex-col items-center justify-center rounded-[20px] border-2 transition-all snap-start shrink-0",
                selectedDateId === d.fullDate 
                  ? "bg-[#D4AF37] border-[#D4AF37] text-white shadow-lg scale-105" 
                  : "bg-white border-[#F3F4F6] text-slate-500 hover:border-[#D4AF37]/30 shadow-[0px_1px_3px_0px_rgba(0,0,0,0.1)]"
              )}
              style={{ minWidth: '76px', height: '96px' }}
            >
              <span className={cn("text-[10px] font-bold uppercase tracking-wider mb-1", selectedDateId === d.fullDate ? "text-white/80" : "text-slate-400")}>{d.dayName}</span>
              <span className="text-2xl font-black">{d.day}</span>
              {d.disabled && <span className="text-[8px] mt-1 font-bold">DOLU</span>}
            </button>
          ))}
        </div>
      </div>

      {/* Time Selection */}
      <div className="space-y-6 px-1">
        <div className="flex items-center justify-between text-[#2D2D2D] font-bold">
          <div className="flex items-center gap-2">
            <Clock style={{ width: '20px', height: '20px', color: '#D4AF37' }} />
            <h3 className="text-lg">Saat Seçin</h3>
          </div>
          <span className="text-[11px] font-bold text-slate-400 bg-slate-100 px-2 py-1 rounded-full shrink-0">~60 DK</span>
        </div>

        <div className="space-y-8">
          {TIME_GROUPS.map((group) => (
            <div key={group.label} className="space-y-4">
              <h4 className="text-[11px] font-black text-slate-400 uppercase tracking-widest pl-1">{group.label}</h4>
              <div className="grid grid-cols-4 gap-3">
                {group.times.map((time) => {
                  const isSelected = selectedDateTime?.time === time && selectedDateTime?.date === selectedDateId;
                  return (
                    <button
                      key={time}
                      onClick={() => handleTimeClick(time)}
                      className={cn(
                        "h-12 rounded-[16px] text-sm font-bold transition-all border-2 flex items-center justify-center shrink-0",
                        isSelected 
                          ? "bg-slate-900 border-slate-900 text-white shadow-md scale-105" 
                          : "bg-white border-[#F3F4F6] text-slate-600 hover:border-[#D4AF37]/30 shadow-[0px_1px_3px_0px_rgba(0,0,0,0.1)]"
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

      {/* Navigation */}
      <div className="fixed bottom-0 left-0 right-0 p-4 bg-white/90 backdrop-blur-md border-t border-[#F3F4F6] z-30 flex justify-between gap-4">
        <Button 
          variant="outline" 
          onClick={onBack} 
          className="flex-1 h-12 rounded-[16px] border-[#F3F4F6] text-slate-500 font-bold hover:bg-slate-50 shadow-sm"
        >
          Geri
        </Button>
        <Button 
          onClick={onNext} 
          disabled={!selectedDateTime}
          className="flex-[2] h-12 rounded-[16px] bg-[#D4AF37] hover:bg-[#B8941F] text-white font-bold shadow-lg shadow-[#D4AF37]/20 active:scale-95 transition-all"
        >
          Devam Et
        </Button>
      </div>
    </div>
  );
}
