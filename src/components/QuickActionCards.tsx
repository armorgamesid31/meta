import { Calendar, Phone, MessageCircle, Star } from 'lucide-react';

export function QuickActionCards() {
  const actions = [
    {
      icon: Calendar,
      title: 'Randevu Geçmişi',
      description: 'Önceki randevularınızı görün',
      color: 'from-blue-500 to-blue-600',
      bgColor: 'bg-blue-50',
      textColor: 'text-blue-700'
    },
    {
      icon: Phone,
      title: 'Salonu Ara',
      description: 'Hemen bağlantı kurun',
      color: 'from-green-500 to-green-600',
      bgColor: 'bg-green-50',
      textColor: 'text-green-700'
    },
    {
      icon: MessageCircle,
      title: 'WhatsApp',
      description: 'Hızlı iletişim',
      color: 'from-green-400 to-green-500',
      bgColor: 'bg-green-50',
      textColor: 'text-green-600'
    },
    {
      icon: Star,
      title: 'Değerlendirme',
      description: 'Deneyiminizi paylaşın',
      color: 'from-yellow-500 to-orange-500',
      bgColor: 'bg-yellow-50',
      textColor: 'text-yellow-700'
    }
  ];

  return (
    <div className="grid grid-cols-2 gap-3">
      {actions.map((action, index) => {
        const IconComponent = action.icon;
        return (
          <button
            key={index}
            className={`${action.bgColor} ${action.textColor} p-4 rounded-[20px] text-left hover:shadow-md transition-all border border-gray-100`}
          >
            <div className={`w-10 h-10 bg-gradient-to-br ${action.color} rounded-xl flex items-center justify-center mb-3`}>
              <IconComponent className="w-5 h-5 text-white" />
            </div>
            <h3 className="font-semibold text-sm mb-1">{action.title}</h3>
            <p className="text-xs opacity-80">{action.description}</p>
          </button>
        );
      })}
    </div>
  );
}