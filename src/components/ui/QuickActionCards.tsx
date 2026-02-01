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
    <div className="flex gap-4 overflow-x-auto pb-2 scrollbar-hide">
      <button
        onClick={onRepeatClick}
        className="flex-1 min-w-[160px] bg-white rounded-2xl p-4 shadow-sm border border-gray-100 cursor-pointer text-left group hover:border-[#BC952B]/30 transition-all"
      >
        <div className="flex items-start gap-3">
          <div className="w-10 h-10 bg-[#FFF9E5] rounded-full flex items-center justify-center flex-shrink-0 group-hover:scale-110 transition-transform">
            <RotateCcw className="w-5 h-5 text-[#BC952B]" strokeWidth={2.5} />
          </div>
          <div>
            <p className="text-[13px] font-bold text-[#1a1a1a] mb-0.5">Son İşlemi Tekrarla</p>
            <p className="text-[11px] text-[#6b7280] font-medium">{lastServiceName}</p>
          </div>
        </div>
      </button>

      <button
        onClick={onPackagesClick}
        className="flex-1 min-w-[160px] bg-white rounded-2xl p-4 shadow-sm border border-gray-100 relative cursor-pointer text-left group hover:border-[#10B981]/30 transition-all"
      >
        <div className="flex items-start gap-3">
          <div className="w-10 h-10 bg-[#ECFDF5] rounded-full flex items-center justify-center flex-shrink-0 group-hover:scale-110 transition-transform">
            <Package className="w-5 h-5 text-[#10B981]" strokeWidth={2.5} />
          </div>
          <div>
            <p className="text-[13px] font-bold text-[#1a1a1a] mb-0.5">Paketlerim</p>
            <p className="text-[11px] text-[#6b7280] font-medium">Aktif paketler</p>
          </div>
        </div>
        {packageCount > 0 && (
          <div className="absolute top-2 right-2 bg-[#10B981] text-white text-[9px] font-bold px-1.5 py-0.5 rounded-lg shadow-sm">
            {packageCount} Seans
          </div>
        )}
      </button>
    </div>
  );
}
