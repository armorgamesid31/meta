import React, { useState } from 'react';
import { ServiceCategory, Service } from './types';
import { ServiceCard } from './ServiceCard';

export interface ServiceCategoryAccordionProps {
  categories: ServiceCategory[];
  selectedServices: Service[];
  onSelectService: (service: Service) => void;
  onDeselectService: (serviceId: string) => void;
  expandedCategoryId?: string;
  onExpandCategory?: (categoryId: string | null) => void;
}

export const ServiceCategoryAccordion: React.FC<ServiceCategoryAccordionProps> = ({
  categories,
  selectedServices,
  onSelectService,
  onDeselectService,
  expandedCategoryId,
  onExpandCategory,
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
            className="border border-gray-200 rounded-lg overflow-hidden"
          >
            <button
              onClick={() => handleToggleCategory(category.id)}
              className="w-full px-4 py-4 flex items-center justify-between hover:bg-gray-50 transition-colors"
              aria-expanded={isExpanded}
            >
              <div className="flex items-center gap-3">
                {category.icon && (
                  <span className="text-lg flex-shrink-0">{category.icon}</span>
                )}
                <div className="text-left">
                  <h3 className="font-semibold text-gray-900">
                    {category.name}
                  </h3>
                  {categoryServiceCount > 0 && (
                    <p className="text-xs text-amber-600 font-medium">
                      {categoryServiceCount} seçili
                    </p>
                  )}
                </div>
              </div>
              <span
                className={`text-gray-600 transition-transform duration-200 ${
                  isExpanded ? 'rotate-180' : ''
                }`}
              >
                ▼
              </span>
            </button>

            {isExpanded && (
              <div className="border-t border-gray-200 bg-gray-50 p-4 space-y-3">
                {category.services.map((service) => (
                  <ServiceCard
                    key={service.id}
                    service={service}
                    isSelected={selectedServices.some((s) => s.id === service.id)}
                    onSelect={onSelectService}
                    onDeselect={onDeselectService}
                    showCheckbox={true}
                    showPrice={true}
                  />
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
};
