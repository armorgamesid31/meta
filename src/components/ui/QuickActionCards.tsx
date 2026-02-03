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
    <div className="flex gap-2 overflow-x-auto pb-1.5 scrollbar-hide">
      <button
        onClick={onRepeatClick}
        className="flex-1 min-w-[130px] bg-white rounded-[12px] p-2.5 shadow-sm border border-gray-100 cursor-pointer text-left group hover:shadow-md hover:border-[#BC952B]/20 transition-all"
      >
        <div className="flex items-start gap-2">
          <div className="w-8 h-8 bg-[#FFF9E5] rounded-full flex items-center justify-center flex-shrink-0 group-hover:scale-105 transition-transform">
            <RotateCcw className="w-4 h-4 text-[#BC952B]" strokeWidth={2.5} />
          </div>
          <div className="min-w-0">
            <p className="text-[11px] font-bold text-[#1a1a1a] mb-0 leading-tight">Son İşlemi</p>
            <p className="text-[9px] text-[#6b7280] font-medium truncate">{lastServiceName}</p>
          </div>
        </div>
      </button>

      <button
        onClick={onPackagesClick}
        className="flex-1 min-w-[130px] bg-white rounded-[12px] p-2.5 shadow-sm border border-gray-100 relative cursor-pointer text-left group hover:shadow-md hover:border-[#10B981]/20 transition-all"
      >
        <div className="flex items-start gap-2">
          <div className="w-8 h-8 bg-[#ECFDF5] rounded-full flex items-center justify-center flex-shrink-0 group-hover:scale-105 transition-transform">
            <Package className="w-4 h-4 text-[#10B981]" strokeWidth={2.5} />
          </div>
          <div className="min-w-0">
            <p className="text-[11px] font-bold text-[#1a1a1a] mb-0 leading-tight">Paketlerim</p>
            <p className="text-[9px] text-[#6b7280] font-medium">Aktif paketler</p>
          </div>
        </div>
        {packageCount > 0 && (
          <div className="absolute top-1.5 right-1.5 bg-[#10B981] text-white text-[7px] font-bold px-1.5 py-0.5 rounded-sm shadow-sm">
            {packageCount}
          </div>
        )}
      </button>
    </div>
  );
}
