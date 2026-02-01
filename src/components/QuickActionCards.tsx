import { RotateCcw, Package } from 'lucide-react';

export function QuickActionCards() {
  return (
    <div className="flex gap-3 overflow-x-auto pb-2 scrollbar-hide">
      {/* Repeat Last Service */}
      <button className="flex-1 min-w-[160px] bg-white rounded-[20px] p-4 shadow-sm hover:shadow-md transition-shadow border border-gray-100">
        <div className="flex items-start gap-3">
          <div className="w-10 h-10 bg-[#D4AF37]/10 rounded-full flex items-center justify-center flex-shrink-0">
            <RotateCcw className="w-5 h-5 text-[#D4AF37]" />
          </div>
          <div className="text-left">
            <p className="text-sm font-medium text-[#2D2D2D] mb-1">
              Son İşlemi Tekrarla
            </p>
            <p className="text-xs text-gray-500">Saç Kesimi</p>
          </div>
        </div>
      </button>

      {/* My Packages */}
      <button className="flex-1 min-w-[160px] bg-white rounded-[20px] p-4 shadow-sm hover:shadow-md transition-shadow border border-gray-100 relative">
        <div className="flex items-start gap-3">
          <div className="w-10 h-10 bg-[#10B981]/10 rounded-full flex items-center justify-center flex-shrink-0">
            <Package className="w-5 h-5 text-[#10B981]" />
          </div>
          <div className="text-left">
            <p className="text-sm font-medium text-[#2D2D2D] mb-1">
              Paketlerim
            </p>
            <p className="text-xs text-gray-500">Aktif paketler</p>
          </div>
        </div>
        {/* Badge */}
        <div className="absolute -top-1 -right-1 bg-[#10B981] text-white text-xs px-2 py-0.5 rounded-full font-medium">
          3 Seans
        </div>
      </button>
    </div>
  );
}
