import React, { useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { ServiceCategory, Service } from './types';
import { ServiceCard } from './ServiceCard';

export interface ServiceCategoryAccordionProps {
  categories: ServiceCategory[];
  selectedServices: Service[];
  onSelectService: (service: Service) => void;
  onDeselectService: (serviceId: string) => void;
  expandedCategoryId?: string;
  onExpandCategory?: (categoryId: string | null) => void;
  variant?: 'default' | 'minimal';
}

export const ServiceCategoryAccordion: React.FC<ServiceCategoryAccordionProps> = ({
  categories,
  selectedServices,
  onSelectService,
  onDeselectService,
  expandedCategoryId,
  onExpandCategory,
  variant = 'default',
}) => {
  const [internalExpandedId, setInternalExpandedId] = useState<string | null>(null);
  const isControlled = expandedCategoryId !== undefined;
  const currentExpandedId = isControlled ? expandedCategoryId : internalExpandedId;

  const handleToggleCategory = (categoryId: string) => {
    const newId = currentExpandedId === categoryId ? null : categoryId;
    if (isControlled) {
      onExpandCategory?.(newId);
    } else {
      setInternalExpandedId(newId);
    }
  };

  return (
    <div className="w-full space-y-2">
      {categories.map((category) => {
        const isExpanded = currentExpandedId === category.id;
        const categoryServiceCount = category.services.filter((s) =>
          selectedServices.some((ss) => ss.id === s.id)
        ).length;

        return (
          <div
            key={category.id}
            className={`rounded-lg overflow-hidden transition-all ${
              variant === 'minimal'
                ? 'border border-gray-200'
                : 'border border-gray-200'
            }`}
          >
            <button
              onClick={() => handleToggleCategory(category.id)}
              className={`w-full px-4 py-4 flex items-center justify-between transition-colors ${
                isExpanded ? 'bg-gray-50' : 'hover:bg-gray-50'
              }`}
              aria-expanded={isExpanded}
            >
              <div className="flex items-center gap-3 flex-1">
                {category.icon && (
                  <span className="text-2xl flex-shrink-0">{category.icon}</span>
                )}
                <div className="text-left">
                  <h3 className="font-semibold text-gray-900 text-base">
                    {category.name}
                  </h3>
                  {categoryServiceCount > 0 && (
                    <p className="text-xs text-amber-600 font-medium">
                      {categoryServiceCount} Seçili
                    </p>
                  )}
                </div>
              </div>
              <ChevronDown
                className={`w-5 h-5 text-gray-600 flex-shrink-0 ml-2 transition-transform duration-200 ${
                  isExpanded ? 'rotate-180' : ''
                }`}
              />
            </button>

            {isExpanded && (
              <div className="border-t border-gray-200 bg-white p-4 space-y-3">
                {category.services.length > 0 ? (
                  category.services.map((service) => (
                    <ServiceCard
                      key={service.id}
                      service={service}
                      isSelected={selectedServices.some((s) => s.id === service.id)}
                      onSelect={onSelectService}
                      onDeselect={onDeselectService}
                      showCheckbox={variant === 'default'}
                      showPrice={true}
                      showAddButton={variant === 'minimal'}
                      variant={variant}
                    />
                  ))
                ) : (
                  <p className="text-sm text-gray-500 text-center py-4">
                    Hizmet bulunamadı
                  </p>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
};
