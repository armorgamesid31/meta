import React from 'react';
import { Check } from 'lucide-react';
import { Service } from './types';

export interface ServiceCardProps {
  service: Service;
  isSelected?: boolean;
  onSelect: (service: Service) => void;
  onDeselect?: (serviceId: string) => void;
  showCheckbox?: boolean;
  showPrice?: boolean;
  showAddButton?: boolean;
  variant?: 'default' | 'minimal';
}

export const ServiceCard: React.FC<ServiceCardProps> = ({
  service,
  isSelected = false,
  onSelect,
  onDeselect,
  showCheckbox = true,
  showPrice = true,
  showAddButton = false,
  variant = 'default',
}) => {
  const handleClick = () => {
    if (isSelected && onDeselect) {
      onDeselect(service.id);
    } else {
      onSelect(service);
    }
  };

  if (variant === 'minimal' && showAddButton) {
    return (
      <button
        onClick={handleClick}
        className="w-full p-3 rounded-lg text-left transition-all duration-200 hover:bg-gray-50 border border-gray-200"
      >
        <div className="flex items-center justify-between">
          <div className="flex-1 min-w-0">
            <h4 className="font-semibold text-gray-900 text-sm">{service.name}</h4>
            {service.description && (
              <p className="text-xs text-gray-600 mt-1">{service.description}</p>
            )}
            <div className="text-xs text-gray-500 mt-1">{service.duration} dk</div>
          </div>
          <div className="flex-shrink-0 flex items-center gap-3">
            {showPrice && (
              <div className="text-right">
                <span className="text-sm font-bold text-amber-600">
                  {service.price.toLocaleString('tr-TR')} TL
                </span>
              </div>
            )}
            <button
              onClick={(e) => {
                e.stopPropagation();
                handleClick();
              }}
              className={`py-2 px-3 rounded-lg font-medium text-xs transition-all duration-200 ${
                isSelected
                  ? 'bg-amber-100 text-amber-600 border border-amber-300'
                  : 'bg-amber-50 text-amber-600 border border-amber-200 hover:bg-amber-100'
              }`}
            >
              {isSelected ? 'Seçili' : 'Ekle'}
            </button>
          </div>
        </div>
      </button>
    );
  }

  return (
    <button
      onClick={handleClick}
      className={`w-full p-4 rounded-lg border-2 text-left transition-all duration-200 ${
        isSelected
          ? 'border-amber-600 bg-amber-50'
          : 'border-gray-200 bg-white hover:border-amber-300 hover:bg-amber-50'
      }`}
      aria-pressed={isSelected}
    >
      <div className="flex items-start gap-3">
        {showCheckbox && (
          <div
            className={`mt-1 w-5 h-5 rounded border-2 flex items-center justify-center flex-shrink-0 transition-all ${
              isSelected
                ? 'bg-amber-600 border-amber-600'
                : 'border-gray-300 hover:border-amber-400'
            }`}
          >
            {isSelected && (
              <Check className="w-3 h-3 text-white" strokeWidth={3} />
            )}
          </div>
        )}

        <div className="flex-1 min-w-0">
          <h4 className="font-semibold text-gray-900 text-sm">{service.name}</h4>
          {service.description && (
            <p className="text-xs text-gray-600 mt-1">{service.description}</p>
          )}
          <div className="text-xs text-gray-500 mt-2">{service.duration} dk</div>
        </div>

        {showPrice && (
          <div className="flex-shrink-0 text-right">
            <span className="text-lg font-bold text-amber-600">
              {service.price.toLocaleString('tr-TR')} TL
            </span>
          </div>
        )}
      </div>
    </button>
  );
};
