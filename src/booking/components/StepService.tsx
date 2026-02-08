import React, { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Search, ChevronRight, Clock, History, Gift, Check, Zap, Plus, Sparkles, User, Scissors, Footprints, Eye, Minus, RefreshCw } from "lucide-react";
import { cn } from "@/lib/utils";

// Mock categories and services with enhanced metadata
const CATEGORIES = [
  {
    id: 'cat1',
    name: 'Epilasyon & Tüy Alma',
    icon: Sparkles,
    color: 'text-amber-500',
    bg: 'bg-amber-50',
    count: 4,
    services: [
      { id: 's1', name: 'Tam Vücut Lazer Paketi', duration: '60 dk', price: '1650 TL', oldPrice: '1800 TL', badge: 'Fast Track', badgeColor: 'bg-amber-400' },
      { id: 's2', name: 'Sırt Lazer', duration: '30 dk', price: '1100 TL', oldPrice: '1200 TL' },
      { id: 's2b', name: 'Bacak Lazer', duration: '45 dk', price: '1500 TL', badge: 'Paket var', badgeColor: 'bg-emerald-100 text-emerald-700' },
      { id: 's2c', name: 'Sir Ağda', duration: '20 dk', price: '400 TL' },
    ]
  },
  {
    id: 'cat2',
    name: 'Cilt Bakımı & Yüz',
    icon: User,
    color: 'text-rose-500',
    bg: 'bg-rose-50',
    count: 4,
    services: [
      { id: 's3', name: 'Klasik Cilt Bakımı', duration: '60 dk', price: '800 TL' },
      { id: 's4', name: 'Hydrafacial', duration: '45 dk', price: '1200 TL' },
    ]
  },
  {
    id: 'cat3',
    name: 'Vücut Şekillendirme',
    icon: User, 
    color: 'text-blue-500',
    bg: 'bg-blue-50',
    count: 3,
    services: []
  },
  {
    id: 'cat4',
    name: 'Tırnak Sanatı & Ayak Bakımı',
    icon: Footprints,
    color: 'text-purple-500',
    bg: 'bg-purple-50',
    count: 4,
    services: []
  }
];

interface StepServiceProps {
  selectedServiceId: string | null;
  onSelect: (serviceId: string) => void;
  onNext: () => void;
}

export function StepService({ selectedServiceId, onSelect, onNext }: StepServiceProps) {
  const [searchQuery, setSearchQuery] = useState("");
  const [expandedCategory, setExpandedCategory] = useState<string | null>('cat1');

  const toggleCategory = (catId: string) => {
    setExpandedCategory(expandedCategory === catId ? null : catId);
  };

  const filteredCategories = CATEGORIES.map(cat => ({
    ...cat,
    services: cat.services.filter(s => s.name.toLowerCase().includes(searchQuery.toLowerCase()))
  })).filter(cat => cat.services.length > 0 || !searchQuery);

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500 pb-20">
      
      {/* Recent & Packages */}
      <div className="space-y-3">
        <Card className="rounded-2xl border-none shadow-sm bg-white overflow-hidden">
            <div className="p-4 flex items-center justify-between cursor-pointer hover:bg-slate-50 transition-colors">
                <div className="flex items-center gap-3">
                    <div className="h-10 w-10 rounded-full bg-amber-50 flex items-center justify-center text-amber-600">
                        <RefreshCw className="h-5 w-5" />
                    </div>
                    <div>
                        <div className="font-semibold text-slate-900">Son Randevular</div>
                        <div className="text-xs text-slate-500">Geçmiş randevularınız</div>
                    </div>
                </div>
                <ChevronRight className="h-5 w-5 text-slate-400" />
            </div>
        </Card>

        <Card className="rounded-2xl border-none shadow-sm bg-white overflow-hidden">
            <div className="p-4 flex items-center justify-between cursor-pointer hover:bg-slate-50 transition-colors">
                <div className="flex items-center gap-3">
                    <div className="h-10 w-10 rounded-full bg-emerald-50 flex items-center justify-center text-emerald-600">
                        <Gift className="h-5 w-5" />
                    </div>
                    <div>
                        <div className="font-semibold text-slate-900">Paketlerim</div>
                        <div className="text-xs text-slate-500">Aktif paketler</div>
                    </div>
                </div>
                <div className="flex items-center gap-2">
                    <span className="bg-emerald-500 text-white text-[10px] font-bold px-2 py-1 rounded-full">6 Seans</span>
                </div>
            </div>
        </Card>
      </div>

      {/* Search */}
      <div className="relative">
        <Search className="absolute left-4 top-3.5 h-5 w-5 text-slate-400" />
        <Input 
          placeholder="Hizmet ara..." 
          className="pl-12 h-12 rounded-2xl bg-white border-slate-200 shadow-sm text-base"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
        />
      </div>

      {/* Categories & Services */}
      <div className="space-y-4">
        {filteredCategories.map((category) => (
          <div key={category.id} className="bg-white rounded-3xl shadow-sm border border-slate-100 overflow-hidden">
            <div 
              className={cn(
                "p-5 flex items-center justify-between cursor-pointer hover:bg-slate-50 transition-colors",
                expandedCategory === category.id && "border-b border-slate-100"
              )}
              onClick={() => toggleCategory(category.id)}
            >
              <div className="flex items-center gap-3">
                <div className={cn("h-8 w-8 rounded-full flex items-center justify-center", category.bg, category.color)}>
                    <category.icon className="h-5 w-5" />
                </div>
                <span className="font-bold text-slate-900 text-lg">
                  {category.name}
                </span>
                <span className="bg-slate-100 text-slate-600 text-xs font-semibold px-2 py-0.5 rounded-md">
                    {category.count}
                </span>
              </div>
              <ChevronRight className={cn("h-5 w-5 text-slate-400 transition-transform duration-300", expandedCategory === category.id && "rotate-90")} />
            </div>
            
            {expandedCategory === category.id && (
              <div className="divide-y divide-slate-100">
                {category.services.map((service) => (
                  <div 
                    key={service.id}
                    className="p-5 hover:bg-slate-50 transition-colors flex flex-row items-center justify-between gap-4"
                  >
                    <div className="flex-1 space-y-1 min-w-0 pr-2">
                      <div className="font-bold text-slate-900 text-base leading-tight">{service.name}</div>
                      <div className="flex flex-wrap items-center gap-2 text-sm text-slate-500">
                        <span className="flex items-center gap-1 shrink-0">
                          <Clock className="h-3 w-3" />
                          {service.duration}
                        </span>
                        {service.badge && (
                            <span className={cn("px-2 py-0.5 rounded-full text-[10px] font-bold flex items-center gap-1 shrink-0", 
                                service.badge === 'Fast Track' ? 'bg-amber-400 text-slate-900' : service.badgeColor
                            )}>
                                {service.badge === 'Fast Track' && <Zap className="h-3 w-3 fill-slate-900" />}
                                {service.badge}
                            </span>
                        )}
                      </div>
                    </div>
                    
                    <div className="flex flex-col items-end gap-2 shrink-0">
                        <div className="text-right">
                             {service.oldPrice && <div className="text-xs text-slate-400 line-through decoration-slate-400">{service.oldPrice}</div>}
                             <div className="font-bold text-emerald-600 text-lg">{service.price}</div>
                        </div>
                        
                        <Button
                            variant="outline"
                            size="sm"
                            className={cn(
                                "rounded-xl border-amber-500 text-amber-600 hover:bg-amber-50 hover:text-amber-700 h-9 px-4 font-semibold shadow-sm transition-all active:scale-95",
                                selectedServiceId === service.id && "bg-amber-500 text-white border-amber-500 hover:bg-amber-600 hover:text-white"
                            )}
                            onClick={() => onSelect(service.id)}
                        >
                            {selectedServiceId === service.id ? (
                                <>
                                    <Check className="h-4 w-4 mr-1" />
                                    Seçildi
                                </>
                            ) : (
                                <>
                                    <Plus className="h-4 w-4 mr-1" />
                                    Ekle
                                </>
                            )}
                        </Button>
                    </div>
                  </div>
                ))}
                {category.services.length === 0 && (
                    <div className="p-8 text-center text-slate-400 text-sm italic">
                        Bu kategoride hizmet bulunamadı.
                    </div>
                )}
              </div>
            )}
          </div>
        ))}
      </div>

      {selectedServiceId && (
        <div className="fixed bottom-0 left-0 right-0 p-4 bg-white border-t border-slate-100 shadow-[0_-4px_20px_-5px_rgba(0,0,0,0.1)] z-20 flex justify-center">
             <Button 
                onClick={onNext} 
                className="w-full max-w-md bg-slate-900 hover:bg-slate-800 text-white rounded-xl h-14 text-lg font-bold shadow-xl"
            >
                Devam Et
            </Button>
        </div>
      )}
    </div>
  );
}
