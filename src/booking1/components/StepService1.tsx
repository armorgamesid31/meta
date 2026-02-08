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
    <div className="space-y-6">
      {/* 1. Quick Actions */}
      <div className="grid grid-cols-2 gap-3">
        <Card className="rounded-[20px] border border-[#F3F4F6] shadow-[0px_1px_3px_0px_rgba(0,0,0,0.1)] hover:shadow-md transition-all cursor-pointer group">
          <CardContent className="p-4 flex flex-col gap-3">
            <div 
                className="w-10 h-10 rounded-full flex items-center justify-center text-[#D4AF37] group-hover:scale-110 transition-transform"
                style={{ background: 'rgba(212, 175, 55, 0.1)' }}
            >
              <RefreshCw className="w-5 h-5" />
            </div>
            <div>
              <p className="font-bold text-[#2D2D2D] text-sm">Son İşlemler</p>
              <p className="text-[11px] text-slate-500 font-medium">Hızlı tekrarla</p>
            </div>
          </CardContent>
        </Card>
        <Card className="rounded-[20px] border border-[#F3F4F6] shadow-[0px_1px_3px_0px_rgba(0,0,0,0.1)] hover:shadow-md transition-all cursor-pointer group">
          <CardContent className="p-4 flex flex-col gap-3 relative overflow-hidden">
            <div 
                className="w-10 h-10 rounded-full flex items-center justify-center text-[#10B981] group-hover:scale-110 transition-transform"
                style={{ background: 'rgba(16, 185, 129, 0.1)' }}
            >
              <Gift className="w-5 h-5" />
            </div>
            <div>
              <p className="font-bold text-[#2D2D2D] text-sm">Paketlerim</p>
              <p className="text-[11px] text-slate-500 font-medium">Aktif seanslar</p>
            </div>
            <div className="absolute top-2 right-2 bg-[#10B981] text-white text-[10px] font-bold px-1.5 py-0.5 rounded-full shadow-sm">
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
          className="pl-12 h-12 rounded-[20px] border-[#F3F4F6] shadow-[0px_1px_3px_0px_rgba(0,0,0,0.1)] focus-visible:ring-[#D4AF37] bg-white text-base"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
        />
      </div>

      {/* 3. Promo Banner - Exact Figma Design */}
      {!searchQuery && (
        <div 
            className="rounded-[20px] p-5 shadow-[0px_4px_6px_-1px_rgba(0,0,0,0.1)] border border-[#D4AF37] relative overflow-hidden group hover:scale-[1.01] transition-all cursor-pointer"
            style={{
                background: 'linear-gradient(135deg, rgba(212, 175, 55, 0.1) 0%, rgba(255, 255, 255, 1) 50%, rgba(212, 175, 55, 0.05) 100%)'
            }}
        >
            <div className="absolute -right-4 -bottom-4 opacity-5 group-hover:rotate-12 transition-transform">
                <Users className="w-32 h-32 text-[#D4AF37]" />
            </div>
            
            <div className="flex items-center gap-4 relative z-10">
                <div className="w-12 h-12 rounded-full bg-[#D4AF37] shadow-sm flex items-center justify-center border border-white/20">
                    <Users className="w-6 h-6 text-white" />
                </div>
                <div className="flex-1 pr-6 space-y-1">
                    <p className="font-bold text-[#2D2D2D] text-sm leading-tight">
                        Randevuna arkadaşını ekle, anında 100 TL kazan!
                    </p>
                    <p className="text-[11px] text-slate-500 font-medium">Hem sen hem de arkadaşın indirim kazanın</p>
                </div>
                <div className="flex items-center absolute top-0 right-0">
                     {/* Switch UI from Figma */}
                     <div className="w-12 h-6 bg-[#D1D5DC] rounded-full relative shadow-inner">
                        <div className="absolute left-1 top-1 w-4 h-4 bg-white rounded-full shadow-md"></div>
                     </div>
                </div>
            </div>
        </div>
      )}

      {/* 4. Categories */}
      <div className="space-y-4">
        {filteredCategories.map((cat) => (
          <div key={cat.id} className="space-y-4">
            <button 
              onClick={() => setExpandedCategory(expandedCategory === cat.id ? null : cat.id)}
              className="flex items-center justify-between w-full px-1"
            >
              <div className="flex items-center gap-3">
                <span className="text-xl">{cat.icon}</span>
                <span className="font-bold text-[#2D2D2D] text-lg">{cat.name}</span>
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
                        "rounded-[20px] border transition-all cursor-pointer overflow-hidden",
                        selected 
                          ? "border-[#D4AF37] bg-amber-50/20 shadow-md scale-[1.01]" 
                          : "border-[#F3F4F6] bg-white hover:border-slate-200 shadow-[0px_1px_3px_0px_rgba(0,0,0,0.1)]"
                      )}
                    >
                      <CardContent className="p-5 flex items-center justify-between gap-4">
                        <div className="flex-1 min-w-0 space-y-2">
                          <div className="space-y-1">
                            <p className="font-bold text-[#2D2D2D] text-base leading-tight truncate">{service.name}</p>
                            <div className="flex items-center gap-3 text-[11px] text-slate-500 font-bold uppercase tracking-wider">
                                <span className="flex items-center gap-1"><Clock className="w-3 h-3 text-slate-400" /> {service.duration} dk</span>
                                {service.badge && (
                                    <span className="bg-amber-400 text-slate-900 px-1.5 py-0.5 rounded-sm flex items-center gap-1">
                                        <Zap className="w-2.5 h-2.5 fill-slate-900" /> {service.badge}
                                    </span>
                                )}
                            </div>
                          </div>
                          {service.hasPackage && (
                            <div className="inline-flex items-center gap-1.5 bg-emerald-50 text-emerald-600 px-2 py-0.5 rounded-full text-[10px] font-bold border border-emerald-100">
                                <Check className="w-3 h-3" /> Paket var
                            </div>
                          )}
                        </div>
                        <div className="flex flex-col items-end gap-3 shrink-0">
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
                          <Button
                            variant="outline"
                            size="sm"
                            className={cn(
                                "rounded-xl h-9 px-4 font-bold border-2 transition-all",
                                selected 
                                    ? "bg-[#D4AF37] border-[#D4AF37] text-white hover:bg-[#B8941F] hover:border-[#B8941F]" 
                                    : "border-[#D4AF37] text-[#D4AF37] hover:bg-amber-50"
                            )}
                          >
                            {selected ? <><Check className="w-4 h-4 mr-1.5" /> Seçildi</> : <><Plus className="w-4 h-4 mr-1.5" /> Ekle</>}
                          </Button>
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
