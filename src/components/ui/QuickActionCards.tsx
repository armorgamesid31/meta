import { RotateCcw, Package } from 'lucide-react';

interface QuickActionCardsProps {
  lastServiceName?: string;
  packageCount?: number;
  onRepeatClick?: () => void;
  onPackagesClick?: () => void;
}

export function QuickActionCards({
  lastServiceName = 'Saç Kesimi',
  packageCount = 0,
  onRepeatClick,
  onPackagesClick,
}: QuickActionCardsProps) {
  return (
    <div className="flex gap-3 overflow-x-auto pb-1 scrollbar-hide">
      {/* Son İşlemi Tekrarla */}
      <button
        onClick={onRepeatClick}
        className="flex-1 min-w-[160px] bg-white rounded-[20px] p-4 shadow-[0_2px_8px_rgba(0,0,0,0.04)] border border-gray-100 hover:shadow-md transition-all cursor-pointer text-left flex items-start gap-3"
      >
        <div className="w-10 h-10 bg-[#FFF8E1] rounded-full flex items-center justify-center flex-shrink-0 border border-[#D4AF37]/10">
          <RotateCcw className="w-5 h-5 text-[#D4AF37]" strokeWidth={2} />
        </div>
        <div>
          <p className="text-[13px] font-semibold text-[#2D2D2D] leading-tight mb-1">
            Son İşlemi
            <br />
            Tekrarla
          </p>
          <p className="text-[11px] text-gray-500 font-medium">{lastServiceName}</p>
        </div>
      </button>

      {/* Paketlerim */}
      <button
        onClick={onPackagesClick}
        className="flex-1 min-w-[160px] bg-white rounded-[20px] p-4 shadow-[0_2px_8px_rgba(0,0,0,0.04)] border border-gray-100 hover:shadow-md transition-all relative cursor-pointer text-left flex items-start gap-3"
      >
        <div className="w-10 h-10 bg-[#ECFDF5] rounded-full flex items-center justify-center flex-shrink-0 border border-[#10B981]/10">
          <Package className="w-5 h-5 text-[#10B981]" strokeWidth={2} />
        </div>
        <div>
          <p className="text-[13px] font-semibold text-[#2D2D2D] leading-tight mb-1">
            Paketlerim
          </p>
          <p className="text-[11px] text-gray-500 font-medium">Aktif paketler</p>
        </div>
        {packageCount > 0 && (
          <div className="absolute top-0 right-0 bg-[#10B981] text-white text-[10px] font-bold px-2 py-1 rounded-bl-[12px] rounded-tr-[18px]">
            {packageCount} Seans
          </div>
        )}
      </button>
    </div>
  );
}
