import React from 'react';
import { Service } from './types';

export interface ServiceCardProps {
  service: Service;
  isSelected?: boolean;
  onSelect: (service: Service) => void;
  onDeselect?: (serviceId: string) => void;
  showCheckbox?: boolean;
  showPrice?: boolean;
}

export const ServiceCard: React.FC<ServiceCardProps> = ({
  service,
  isSelected = false,
  onSelect,
  onDeselect,
  showCheckbox = true,
  showPrice = true,
}) => {
  const handleClick = () => {
    if (isSelected && onDeselect) {
      onDeselect(service.id);
    } else {
      onSelect(service);
    }
  };

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
            className={`mt-1 w-5 h-5 rounded border-2 flex items-center justify-center flex-shrink-0 ${
              isSelected ? 'bg-amber-600 border-amber-600' : 'border-gray-300'
            }`}
          >
            {isSelected && <span className="text-white text-xs">✓</span>}
          </div>
        )}

        <div className="flex-1 min-w-0">
          <h4 className="font-semibold text-gray-900 text-sm">{service.name}</h4>
          {service.description && (
            <p className="text-xs text-gray-600 mt-1">{service.description}</p>
          )}
          <div className="text-xs text-gray-500 mt-2">
            {service.duration} dk
          </div>
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
