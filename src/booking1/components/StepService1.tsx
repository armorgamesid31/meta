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

  return (
    <div className="space-y-6">
      {/* 1. Quick Actions */}
      <div className="grid grid-cols-2 gap-3">
        <Card className="rounded-[20px] border border-slate-100 shadow-sm hover:shadow-md transition-all cursor-pointer group">
          <CardContent className="p-4 flex flex-col gap-3">
            <div className="w-10 h-10 rounded-full bg-amber-50 flex items-center justify-center text-amber-600 group-hover:scale-110 transition-transform">
              <RefreshCw className="w-5 h-5" />
            </div>
            <div>
              <p className="font-bold text-slate-900 text-sm">Son İşlemler</p>
              <p className="text-[11px] text-slate-500">Hızlı tekrarla</p>
            </div>
          </CardContent>
        </Card>
        <Card className="rounded-[20px] border border-slate-100 shadow-sm hover:shadow-md transition-all cursor-pointer group">
          <CardContent className="p-4 flex flex-col gap-3 relative overflow-hidden">
            <div className="w-10 h-10 rounded-full bg-emerald-50 flex items-center justify-center text-emerald-600 group-hover:scale-110 transition-transform">
              <Gift className="w-5 h-5" />
            </div>
            <div>
              <p className="font-bold text-slate-900 text-sm">Paketlerim</p>
              <p className="text-[11px] text-slate-500">6 Aktif seans</p>
            </div>
            <div className="absolute top-2 right-2 bg-emerald-500 text-white text-[10px] font-bold px-1.5 py-0.5 rounded-full">
              6
            </div>
          </CardContent>
        </Card>
      </div>

      {/* 2. Search */}
      <div className="relative">
        <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400" />
        <Input 
          placeholder="Hizmet ara..." 
          className="pl-12 h-13 rounded-[20px] border-slate-100 shadow-sm focus-visible:ring-[#D4AF37] bg-white"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
        />
      </div>

      {/* 3. Promo Banner - Figma Style */}
      <div 
        className="rounded-[24px] p-5 shadow-lg border border-[#D4AF37]/30 relative overflow-hidden group hover:scale-[1.02] transition-all cursor-pointer"
        style={{
          background: 'linear-gradient(135deg, rgba(212, 175, 55, 0.12) 0%, rgba(255, 255, 255, 1) 50%, rgba(212, 175, 55, 0.08) 100%)'
        }}
      >
        <div className="absolute -right-4 -bottom-4 opacity-5 group-hover:rotate-12 transition-transform">
          <Users className="w-32 h-32 text-[#D4AF37]" />
        </div>
        <div className="flex items-center gap-4 relative z-10">
          <div className="w-12 h-12 rounded-full bg-white shadow-sm flex items-center justify-center border border-[#D4AF37]/20">
            <Users className="w-6 h-6 text-[#D4AF37]" />
          </div>
          <div className="flex-1 pr-6">
            <p className="font-bold text-slate-900 text-sm leading-snug">
              Arkadaşını getir, her ikiniz de %20 indirim kazanın!
            </p>
          </div>
          <ChevronRight className="w-5 h-5 text-slate-400 group-hover:translate-x-1 transition-transform" />
        </div>
      </div>

      {/* 4. Categories */}
      <div className="space-y-4">
        {CATEGORIES.map((cat) => (
          <div key={cat.id} className="space-y-3">
            <button 
              onClick={() => setExpandedCategory(expandedCategory === cat.id ? null : cat.id)}
              className="flex items-center justify-between w-full px-2"
            >
              <div className="flex items-center gap-3">
                <span className="text-xl">{cat.icon}</span>
                <span className="font-bold text-slate-900">{cat.name}</span>
                <span className="bg-slate-100 text-slate-500 text-[11px] font-bold px-2 py-0.5 rounded-full">
                  {cat.services.length}
                </span>
              </div>
              <ChevronRight className={cn("w-5 h-5 text-slate-400 transition-transform duration-300", expandedCategory === cat.id && "rotate-90")} />
            </button>

            {expandedCategory === cat.id && (
              <div className="space-y-3 animate-in fade-in slide-in-from-top-2 duration-300">
                {cat.services.map((service) => {
                  const selected = isSelected(service.id);
                  return (
                    <Card 
                      key={service.id}
                      onClick={() => onToggleService(service as any)}
                      className={cn(
                        "rounded-[20px] border transition-all cursor-pointer",
                        selected 
                          ? "border-[#D4AF37] bg-amber-50/30 shadow-md scale-[1.01]" 
                          : "border-slate-100 bg-white hover:border-slate-200"
                      )}
                    >
                      <CardContent className="p-4 flex items-center justify-between gap-4">
                        <div className="flex-1 min-w-0 space-y-1">
                          <div className="flex items-center gap-2">
                            <p className="font-bold text-slate-900 truncate">{service.name}</p>
                            {service.badge && (
                              <span className="bg-amber-400 text-slate-900 text-[9px] font-black px-1.5 py-0.5 rounded-sm uppercase tracking-tighter">
                                {service.badge}
                              </span>
                            )}
                          </div>
                          <div className="flex items-center gap-3 text-[11px] text-slate-500 font-medium">
                            <span className="flex items-center gap-1"><Clock className="w-3 h-3" /> {service.duration} dk</span>
                            {service.hasPackage && (
                              <span className="text-emerald-600 flex items-center gap-1">
                                <Check className="w-3 h-3" /> Paket var
                              </span>
                            )}
                          </div>
                        </div>
                        <div className="flex flex-col items-end gap-2 shrink-0">
                          <div className="text-right">
                            {service.discountedPrice ? (
                              <>
                                <span className="text-[10px] text-slate-400 line-through block leading-none">{service.price} ₺</span>
                                <span className="text-lg font-black text-emerald-600">{service.discountedPrice} ₺</span>
                              </>
                            ) : (
                              <span className="text-lg font-black text-slate-900">{service.price} ₺</span>
                            )}
                          </div>
                          <div className={cn(
                            "w-8 h-8 rounded-full flex items-center justify-center transition-all",
                            selected ? "bg-[#D4AF37] text-white scale-110" : "bg-slate-50 text-slate-400 border border-slate-200 group-hover:border-[#D4AF37]"
                          )}>
                            {selected ? <Check className="w-5 h-5" /> : <Plus className="w-4 h-4" />}
                          </div>
                        </div>
                      </CardContent>
                    </Card>
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
