import React, { useState } from 'react';
import { Card, CardContent } from "../../components/ui/card";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import { Search, ChevronRight, Clock, History, Gift, Check, Zap, Plus, Users, RefreshCw } from "lucide-react";
import { cn } from "../../lib/utils";
import { Service } from "../BookingPage1";

interface StepService1Props {
  selectedServices: Service[];
  onToggleService: (service: Service) => void;
  onNext: () => void;
}

const CATEGORIES = [
  {
    id: 'cat1',
    name: 'Epilasyon & Tüy Alma',
    icon: '✨',
    services: [
      { id: 1, name: 'Tam Vücut Lazer Paketi', duration: 60, price: 1800, discountedPrice: 1650, badge: 'Fast Track' },
      { id: 2, name: 'Sırt Lazer', duration: 30, price: 1200, discountedPrice: 1100 },
      { id: 3, name: 'Bacak Lazer', duration: 45, price: 1500, hasPackage: true },
      { id: 4, name: 'Sir Ağda', duration: 20, price: 400 },
    ]
  },
  {
    id: 'cat2',
    name: 'Cilt Bakımı & Yüz',
    icon: '💆‍♀️',
    services: [
      { id: 5, name: 'Klasik Cilt Bakımı', duration: 60, price: 800 },
      { id: 6, name: 'Hydrafacial', duration: 45, price: 1200 },
    ]
  }
];

export function StepService1({ selectedServices, onToggleService, onNext }: StepService1Props) {
  const [searchQuery, setSearchQuery] = useState("");
  const [expandedCategory, setExpandedCategory] = useState<string | null>('cat1');

  const isSelected = (id: number) => selectedServices.some(s => s.id === id);

  const filteredCategories = CATEGORIES.map(cat => ({
    ...cat,
    services: cat.services.filter(s => s.name.toLowerCase().includes(searchQuery.toLowerCase()))
  })).filter(cat => cat.services.length > 0 || !searchQuery);

  return (
    <div className="space-y-6 pb-24">
      {/* 1. Quick Actions - Isolated Flex */}
      <div className="flex gap-3 w-full">
        <div 
            className="flex-1 bg-white rounded-[20px] border border-[#F3F4F6] shadow-[0px_1px_3px_0px_rgba(0,0,0,0.1)] hover:shadow-md transition-all cursor-pointer group p-4 flex flex-col gap-3 min-w-0"
            onClick={() => {}}
        >
            <div 
                className="rounded-full flex items-center justify-center text-[#D4AF37] group-hover:scale-110 transition-transform shrink-0"
                style={{ background: 'rgba(212, 175, 55, 0.1)', width: '40px', height: '40px' }}
            >
              <RefreshCw style={{ width: '20px', height: '20px' }} />
            </div>
            <div className="min-w-0">
              <p className="font-bold text-[#2D2D2D] text-sm truncate">Son İşlemler</p>
              <p className="text-[11px] text-slate-500 font-medium truncate">Hızlı tekrarla</p>
            </div>
        </div>
        <div 
            className="flex-1 bg-white rounded-[20px] border border-[#F3F4F6] shadow-[0px_1px_3px_0px_rgba(0,0,0,0.1)] hover:shadow-md transition-all cursor-pointer group p-4 flex flex-col gap-3 min-w-0 relative overflow-hidden"
            onClick={() => {}}
        >
            <div 
                className="rounded-full flex items-center justify-center text-[#10B981] group-hover:scale-110 transition-transform shrink-0"
                style={{ background: 'rgba(16, 185, 129, 0.1)', width: '40px', height: '40px' }}
            >
              <Gift style={{ width: '20px', height: '20px' }} />
            </div>
            <div className="min-w-0">
              <p className="font-bold text-[#2D2D2D] text-sm truncate">Paketlerim</p>
              <p className="text-[11px] text-slate-500 font-medium truncate">Aktif seanslar</p>
            </div>
            <div 
                className="absolute top-2 right-2 bg-[#10B981] text-white text-[10px] font-bold rounded-full shadow-sm flex items-center justify-center"
                style={{ width: '18px', height: '18px' }}
            >
              6
            </div>
        </div>
      </div>

      {/* 2. Search */}
      <div className="relative w-full" style={{ height: '48px' }}>
        <div className="absolute left-4 top-1/2 -translate-y-1/2 z-10 pointer-events-none">
            <Search style={{ width: '20px', height: '20px', color: '#94a3b8' }} />
        </div>
        <input 
          type="text"
          placeholder="Hizmet ara..." 
          className="w-full h-full pl-12 pr-4 rounded-[20px] border border-[#F3F4F6] shadow-[0px_1px_3px_0px_rgba(0,0,0,0.1)] outline-none focus:border-[#D4AF37] bg-white text-base transition-all"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
        />
      </div>

      {/* 3. Promo Banner - Isolated styling */}
      {!searchQuery && (
        <div 
            className="rounded-[20px] p-5 shadow-[0px_4px_6px_-1px_rgba(0,0,0,0.1)] border border-[#D4AF37] relative overflow-hidden group hover:scale-[1.01] transition-all cursor-pointer flex items-center gap-4"
            style={{
                background: 'linear-gradient(135deg, rgba(212, 175, 55, 0.1) 0%, rgba(255, 255, 255, 1) 50%, rgba(212, 175, 55, 0.05) 100%)'
            }}
        >
            <div className="absolute -right-4 -bottom-4 opacity-5 group-hover:rotate-12 transition-transform pointer-events-none">
                <Users style={{ width: '128px', height: '128px', color: '#D4AF37' }} />
            </div>
            
            <div 
                className="rounded-full bg-[#D4AF37] shadow-sm flex items-center justify-center border border-white/20 shrink-0"
                style={{ width: '48px', height: '48px' }}
            >
                <Users style={{ width: '24px', height: '24px', color: 'white' }} />
            </div>
            <div className="flex-1 pr-6 space-y-1 min-w-0">
                <p className="font-bold text-[#2D2D2D] text-sm leading-tight">
                    Randevuna arkadaşını ekle, anında 100 TL kazan!
                </p>
                <p className="text-[11px] text-slate-500 font-medium truncate">Hem sen hem de arkadaşın indirim kazanın</p>
            </div>
            <div className="absolute top-4 right-4 shrink-0">
                    {/* Switch UI */}
                    <div className="bg-[#D1D5DC] rounded-full relative shadow-inner" style={{ width: '44px', height: '22px' }}>
                    <div className="absolute left-1 top-1 bg-white rounded-full shadow-md" style={{ width: '14px', height: '14px' }}></div>
                    </div>
            </div>
        </div>
      )}

      {/* 4. Categories */}
      <div className="space-y-4 w-full">
        {filteredCategories.map((cat) => (
          <div key={cat.id} className="space-y-4 w-full">
            <button 
              onClick={() => setExpandedCategory(expandedCategory === cat.id ? null : cat.id)}
              className="flex items-center justify-between w-full px-1 hover:opacity-80 transition-opacity"
            >
              <div className="flex items-center gap-3 min-w-0">
                <span className="text-xl shrink-0">{cat.icon}</span>
                <span className="font-bold text-[#2D2D2D] text-lg truncate">{cat.name}</span>
                <span className="bg-slate-100 text-slate-500 text-[11px] font-bold px-2 py-0.5 rounded-full shrink-0">
                  {cat.services.length}
                </span>
              </div>
              <ChevronRight className={cn("w-5 h-5 text-slate-400 transition-transform duration-300 shrink-0", expandedCategory === cat.id && "rotate-90")} />
            </button>

            {expandedCategory === cat.id && (
              <div className="space-y-3 animate-in fade-in slide-in-from-top-2 duration-300 w-full">
                {cat.services.map((service) => {
                  const selected = isSelected(service.id);
                  return (
                    <div 
                      key={service.id}
                      onClick={() => onToggleService(service as any)}
                      className={cn(
                        "rounded-[20px] border transition-all cursor-pointer overflow-hidden p-5 flex items-center justify-between gap-4 w-full",
                        selected 
                          ? "border-[#D4AF37] bg-amber-50/20 shadow-md scale-[1.01]" 
                          : "border-[#F3F4F6] bg-white hover:border-slate-200 shadow-[0px_1px_3px_0px_rgba(0,0,0,0.1)]"
                      )}
                    >
                        <div className="flex-1 min-w-0 space-y-2">
                          <div className="space-y-1">
                            <p className="font-bold text-[#2D2D2D] text-base leading-tight truncate">{service.name}</p>
                            <div className="flex items-center gap-3 text-[11px] text-slate-500 font-bold uppercase tracking-wider">
                                <span className="flex items-center gap-1 shrink-0"><Clock style={{ width: '12px', height: '12px' }} className="text-slate-400" /> {service.duration} dk</span>
                                {service.badge && (
                                    <span className="bg-[#D4AF37] text-white px-1.5 py-0.5 rounded-sm flex items-center gap-1 shrink-0">
                                        <Zap style={{ width: '10px', height: '10px' }} fill="white" /> {service.badge}
                                    </span>
                                )}
                            </div>
                          </div>
                          {service.hasPackage && (
                            <div className="inline-flex items-center gap-1.5 bg-emerald-50 text-emerald-600 px-2 py-0.5 rounded-full text-[10px] font-bold border border-emerald-100 shrink-0">
                                <Check style={{ width: '12px', height: '12px' }} /> Paket var
                            </div>
                          )}
                        </div>
                        <div className="flex flex-col items-end gap-3 shrink-0 ml-auto">
                          <div className="text-right">
                            {service.discountedPrice ? (
                              <>
                                <span className="text-[11px] text-slate-400 line-through block leading-none font-bold mb-0.5">{service.price} ₺</span>
                                <span className="text-xl font-black text-[#10B981]">{service.discountedPrice} ₺</span>
                              </>
                            ) : (
                              <span className="text-xl font-black text-[#2D2D2D]">{service.price} ₺</span>
                            )}
                          </div>
                          <div className={cn(
                                "rounded-xl h-9 px-4 flex items-center justify-center font-bold border-2 transition-all text-sm",
                                selected 
                                    ? "bg-[#D4AF37] border-[#D4AF37] text-white shadow-sm" 
                                    : "border-[#D4AF37] text-[#D4AF37] hover:bg-amber-50"
                            )}>
                            {selected ? <><Check style={{ width: '16px', height: '16px' }} className="mr-1.5" /> Seçildi</> : <><span className="text-lg mr-1">+</span> Ekle</>}
                          </div>
                        </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
