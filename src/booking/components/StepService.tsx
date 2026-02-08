import React, { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Search, ChevronRight, Clock, History, Gift, Check } from "lucide-react";
import { cn } from "@/lib/utils";

// Mock categories and services
const CATEGORIES = [
  {
    id: 'cat1',
    name: 'Epilasyon & Tüy Alma',
    count: 4,
    services: [
      { id: 's1', name: 'Tüm Vücut Lazer', duration: '60 dk', price: '1500 TL' },
      { id: 's2', name: 'Kolaltı Lazer', duration: '15 dk', price: '300 TL' },
    ]
  },
  {
    id: 'cat2',
    name: 'Cilt Bakımı & Yüz',
    count: 4,
    services: [
      { id: 's3', name: 'Klasik Cilt Bakımı', duration: '60 dk', price: '800 TL' },
      { id: 's4', name: 'Hydrafacial', duration: '45 dk', price: '1200 TL' },
    ]
  },
  {
    id: 'cat3',
    name: 'Saç Kesimi & Bakım',
    count: 3,
    services: [
      { id: 's5', name: 'Saç Kesimi', duration: '30 dk', price: '150 TL' },
      { id: 's6', name: 'Fön', duration: '15 dk', price: '100 TL' },
    ]
  }
];

// Mock recent service
const RECENT_SERVICE = { id: 's5', name: 'Saç Kesimi', duration: '30 dk', price: '150 TL' };

interface StepServiceProps {
  selectedServiceId: string | null;
  onSelect: (serviceId: string) => void;
  onNext: () => void;
}

export function StepService({ selectedServiceId, onSelect, onNext }: StepServiceProps) {
  const [searchQuery, setSearchQuery] = useState("");
  const [expandedCategory, setExpandedCategory] = useState<string | null>(null);

  const toggleCategory = (catId: string) => {
    setExpandedCategory(expandedCategory === catId ? null : catId);
  };

  const filteredCategories = CATEGORIES.map(cat => ({
    ...cat,
    services: cat.services.filter(s => s.name.toLowerCase().includes(searchQuery.toLowerCase()))
  })).filter(cat => cat.services.length > 0);

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
      {/* Quick Actions */}
      {!searchQuery && (
        <div className="grid grid-cols-2 gap-3 mb-4">
          <Card 
            className="bg-orange-50/50 border-orange-100 cursor-pointer hover:bg-orange-50 transition-colors"
            onClick={() => onSelect(RECENT_SERVICE.id)}
          >
            <CardContent className="p-4 flex flex-col items-start gap-2">
              <div className="flex items-center gap-2 text-orange-600 font-medium text-sm">
                <History className="h-4 w-4" />
                <span>Tekrarla</span>
              </div>
              <div className="text-sm font-semibold text-slate-900">{RECENT_SERVICE.name}</div>
            </CardContent>
          </Card>
          
          <Card className="bg-emerald-50/50 border-emerald-100 cursor-pointer hover:bg-emerald-50 transition-colors">
            <CardContent className="p-4 flex flex-col items-start gap-2">
              <div className="flex items-center gap-2 text-emerald-600 font-medium text-sm">
                <Gift className="h-4 w-4" />
                <span>Paketlerim</span>
              </div>
              <div className="text-sm font-semibold text-slate-900">Aktif Paketler</div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Search */}
      <div className="relative">
        <Search className="absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
        <Input 
          placeholder="Hizmet ara..." 
          className="pl-9 bg-white border-slate-200"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
        />
      </div>

      {/* Categories & Services */}
      <div className="space-y-3">
        {filteredCategories.map((category) => (
          <Card key={category.id} className="overflow-hidden border-slate-200 shadow-sm">
            <div 
              className={cn(
                "p-4 flex items-center justify-between cursor-pointer bg-slate-50/50 hover:bg-slate-50 transition-colors",
                expandedCategory === category.id && "bg-slate-50 border-b border-slate-100"
              )}
              onClick={() => toggleCategory(category.id)}
            >
              <span className="font-medium text-slate-900 flex items-center gap-2">
                {category.name}
                <span className="text-xs text-slate-400 font-normal ml-1">{category.services.length}</span>
              </span>
              <ChevronRight className={cn("h-4 w-4 text-slate-400 transition-transform", expandedCategory === category.id && "rotate-90")} />
            </div>
            
            {expandedCategory === category.id && (
              <div className="divide-y divide-slate-100">
                {category.services.map((service) => (
                  <div 
                    key={service.id}
                    className={cn(
                      "p-4 cursor-pointer hover:bg-slate-50 transition-colors flex items-center justify-between group",
                      selectedServiceId === service.id && "bg-slate-900/5 hover:bg-slate-900/5"
                    )}
                    onClick={() => onSelect(service.id)}
                  >
                    <div className="flex flex-col gap-1">
                      <span className={cn("font-medium text-sm", selectedServiceId === service.id ? "text-slate-900" : "text-slate-700")}>
                        {service.name}
                      </span>
                      <div className="flex items-center gap-3 text-xs text-slate-500">
                        <span className="flex items-center gap-1">
                          <Clock className="h-3 w-3" />
                          {service.duration}
                        </span>
                        <span className="font-semibold text-slate-900">{service.price}</span>
                      </div>
                    </div>
                    {selectedServiceId === service.id ? (
                      <div className="h-6 w-6 rounded-full bg-slate-900 flex items-center justify-center">
                        <Check className="h-3 w-3 text-white" />
                      </div>
                    ) : (
                      <div className="h-6 w-6 rounded-full border border-slate-200 group-hover:border-slate-300" />
                    )}
                  </div>
                ))}
              </div>
            )}
          </Card>
        ))}
      </div>

      <div className="flex justify-end pt-4 sticky bottom-0 bg-gradient-to-t from-white via-white to-transparent pb-4">
        <Button 
          onClick={onNext} 
          disabled={!selectedServiceId}
          className="w-full sm:w-auto shadow-lg"
          size="lg"
        >
          Devam Et
        </Button>
      </div>
    </div>
  );
}
