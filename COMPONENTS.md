# Salon Booking Components - Complete Rebuild

## Overview

All 8 components have been rebuilt from scratch as **presentational, props-driven components** with zero backend dependencies. They follow modern React patterns and are production-ready.

**Stack:**
- React 19
- TypeScript
- Tailwind CSS (v4)
- Vite-compatible
- Zero external dependencies (aside from React)

---

## Components

### 1. **PrimaryActionButton**
Primary call-to-action button with loading and disabled states.

```typescript
<PrimaryActionButton
  label="Randevuyu Onayla"
  onClick={() => handleBooking()}
  disabled={!isFormComplete}
  loading={isSubmitting}
  variant="default" // or "secondary"
/>
```

**Props:**
- `label: string` - Button text
- `onClick?: () => void` - Click handler
- `disabled?: boolean` - Disable state
- `loading?: boolean` - Shows spinner
- `variant?: 'default' | 'secondary'` - Style variant
- `className?: string` - Additional CSS classes

---

### 2. **DateSelector**
Horizontal scrollable date picker with individual date selection.

```typescript
<DateSelector
  dates={dateOptions}
  selectedDateId={selectedDate}
  onSelectDate={(dateId) => setSelectedDate(dateId)}
  label="Tarih Seçin"
/>
```

**Props:**
- `dates: DateOption[]` - Array of available dates
- `selectedDateId?: string` - Currently selected date ID
- `onSelectDate: (dateId: string) => void` - Selection handler
- `label?: string` - Section label

**DateOption Interface:**
```typescript
interface DateOption {
  id: string;
  date: Date;
  dayOfMonth: number;
  dayName: string;
  available: boolean;
}
```

---

### 3. **TimeSlotGrid**
Grid of available time slots with selection capability.

```typescript
<TimeSlotGrid
  slots={timeSlots}
  selectedSlotId={selectedTime}
  onSelectSlot={(slotId) => setSelectedTime(slotId)}
  slotsPerRow={3}
  label="Saat Seçin"
/>
```

**Props:**
- `slots: TimeSlot[]` - Array of available slots
- `selectedSlotId?: string` - Currently selected slot
- `onSelectSlot: (slotId: string) => void` - Selection handler
- `label?: string` - Section label
- `slotsPerRow?: number` - Columns in grid (default: 3)

**TimeSlot Interface:**
```typescript
interface TimeSlot {
  id: string;
  time: string; // e.g., "09:00"
  available: boolean;
}
```

---

### 4. **ServiceCard**
Individual service item with checkbox, name, description, and price.

```typescript
<ServiceCard
  service={service}
  isSelected={isSelected}
  onSelect={(service) => handleSelect(service)}
  onDeselect={(serviceId) => handleDeselect(serviceId)}
  showCheckbox={true}
  showPrice={true}
/>
```

**Props:**
- `service: Service` - Service data
- `isSelected?: boolean` - Selection state
- `onSelect: (service: Service) => void` - Select handler
- `onDeselect?: (serviceId: string) => void` - Deselect handler
- `showCheckbox?: boolean` - Show/hide checkbox (default: true)
- `showPrice?: boolean` - Show/hide price (default: true)

**Service Interface:**
```typescript
interface Service {
  id: string;
  name: string;
  description?: string;
  duration: number; // in minutes
  price: number;
}
```

---

### 5. **ServiceCategoryAccordion**
Accordion container for service categories with multi-select capability.

```typescript
<ServiceCategoryAccordion
  categories={categories}
  selectedServices={selectedServices}
  onSelectService={(service) => handleSelectService(service)}
  onDeselectService={(serviceId) => handleDeselectService(serviceId)}
  expandedCategoryId={expandedCategoryId}
  onExpandCategory={(categoryId) => setExpandedCategoryId(categoryId)}
/>
```

**Props:**
- `categories: ServiceCategory[]` - Array of service categories
- `selectedServices: Service[]` - Currently selected services
- `onSelectService: (service: Service) => void` - Add service handler
- `onDeselectService: (serviceId: string) => void` - Remove service handler
- `expandedCategoryId?: string` - Currently expanded category
- `onExpandCategory?: (categoryId: string | null) => void` - Expansion handler

**ServiceCategory Interface:**
```typescript
interface ServiceCategory {
  id: string;
  name: string;
  icon?: string; // emoji or icon
  services: Service[];
}
```

---

### 6. **BookingInfoForm**
Customer information form with name, phone, gender, and birth date fields.

```typescript
<BookingInfoForm
  data={formData}
  onChange={(data) => setFormData(data)}
  showBirthDate={true}
/>
```

**Props:**
- `data?: FormData` - Form data object
- `onChange?: (data: FormData) => void` - Change handler
- `showBirthDate?: boolean` - Show/hide birth date field
- `nameLabel?: string` - Custom name field label
- `phoneLabel?: string` - Custom phone field label
- `genderLabel?: string` - Custom gender field label
- `birthDateLabel?: string` - Custom birth date field label

**FormData Interface:**
```typescript
interface FormData {
  name: string;
  phone: string;
  gender: 'male' | 'female' | 'other';
  birthDate?: string;
}
```

---

### 7. **BottomPriceSummary**
Sticky footer with price breakdown and confirmation button.

```typescript
<BottomPriceSummary
  breakdown={priceBreakdown}
  onConfirm={() => handleConfirm()}
  onCancel={() => handleCancel()}
  confirmLabel="Randevuyu Onayla"
  showBreakdown={true}
  loading={isProcessing}
/>
```

**Props:**
- `breakdown: PriceBreakdown` - Price breakdown object
- `onConfirm: () => void` - Confirmation handler
- `onCancel?: () => void` - Cancellation handler
- `confirmLabel?: string` - Custom confirm button text
- `showBreakdown?: boolean` - Show/hide price details
- `loading?: boolean` - Loading state

**PriceBreakdown Interface:**
```typescript
interface PriceBreakdown {
  subtotal: number;
  discount?: number;
  tax?: number;
  total: number;
}
```

---

### 8. **WelcomeSelectorCard**
Complete booking flow component combining date, time, and form selection.

```typescript
<WelcomeSelectorCard
  title="Randevu Al"
  dates={dateOptions}
  timeSlots={timeSlots}
  selectedDateId={selectedDate}
  selectedTimeSlotId={selectedTime}
  formData={formData}
  onSelectDate={(dateId) => setSelectedDate(dateId)}
  onSelectTimeSlot={(slotId) => setSelectedTime(slotId)}
  onFormChange={(data) => setFormData(data)}
  onProceed={() => handleProceed()}
  showNotificationBanner={true}
  notificationMessage="Bu Gün İçin Bekleme Listesine Girin..."
  onBannerAction={() => handleBannerAction()}
/>
```

**Props:**
- `title?: string` - Card title
- `subtitle?: string` - Card subtitle
- `dates: DateOption[]` - Available dates
- `timeSlots: TimeSlot[]` - Available time slots
- `selectedDateId?: string` - Selected date
- `selectedTimeSlotId?: string` - Selected time
- `formData?: FormData` - Customer data
- `showNotificationBanner?: boolean` - Show notification
- `notificationMessage?: string` - Banner message
- `onSelectDate: (dateId: string) => void` - Date selection handler
- `onSelectTimeSlot: (slotId: string) => void` - Time selection handler
- `onFormChange?: (data: FormData) => void` - Form change handler
- `onProceed?: () => void` - Proceed handler
- `proceedLabel?: string` - Proceed button text
- `bannerActionLabel?: string` - Banner button text
- `onBannerAction?: () => void` - Banner action handler

---

## Design System

### Color Palette
- **Primary:** Gold/Mustard (#C9A961)
- **Primary Dark:** #B39650
- **Primary Light:** #E8D5B8
- **Background:** White (#FFFFFF)
- **Text Primary:** Dark Gray (#1F2937)
- **Text Secondary:** Medium Gray (#6B7280)
- **Border:** Light Gray (#E5E7EB)

### Typography
- **Font:** Inter (system fallback)
- **Sizes:** 12px, 14px, 16px, 18px, 20px+
- **Weights:** Regular (400), Medium (500), Semibold (600), Bold (700)

### Spacing
- Uses Tailwind's standard spacing scale (4px base unit)
- Gap between elements: 8px, 12px, 16px

### Borders & Corners
- Border radius: 8px (rounded-lg), 12px (rounded-xl)
- Border width: 1px standard, 2px for active states

### Shadows
- Subtle: `shadow-md`
- Prominent: `shadow-lg`

---

## Integration Example

```typescript
import {
  WelcomeSelectorCard,
  ServiceCategoryAccordion,
  BottomPriceSummary,
  FormData,
  TimeSlot,
  Service,
  ServiceCategory,
  PriceBreakdown,
} from '@/components/bookingComponents';

export function BookingPage() {
  const [selectedDate, setSelectedDate] = useState<string>();
  const [selectedTime, setSelectedTime] = useState<string>();
  const [selectedServices, setSelectedServices] = useState<Service[]>([]);
  const [formData, setFormData] = useState<FormData>({
    name: '',
    phone: '',
    gender: 'female',
  });

  const calculatePrice = (): PriceBreakdown => {
    const total = selectedServices.reduce((sum, s) => sum + s.price, 0);
    return { subtotal: total, total };
  };

  const handleBooking = async () => {
    // Send to your backend
    const bookingData = {
      date: selectedDate,
      time: selectedTime,
      services: selectedServices,
      customer: formData,
    };
    
    const response = await fetch('/api/bookings', {
      method: 'POST',
      body: JSON.stringify(bookingData),
    });
  };

  return (
    <div>
      <WelcomeSelectorCard
        dates={dates}
        timeSlots={timeSlots}
        selectedDateId={selectedDate}
        selectedTimeSlotId={selectedTime}
        formData={formData}
        onSelectDate={setSelectedDate}
        onSelectTimeSlot={setSelectedTime}
        onFormChange={setFormData}
      />

      <ServiceCategoryAccordion
        categories={serviceCategories}
        selectedServices={selectedServices}
        onSelectService={(s) => setSelectedServices([...selectedServices, s])}
        onDeselectService={(id) =>
          setSelectedServices(selectedServices.filter((s) => s.id !== id))
        }
      />

      <BottomPriceSummary
        breakdown={calculatePrice()}
        onConfirm={handleBooking}
      />
    </div>
  );
}
```

---

## Features

✅ **Fully Typed** - Complete TypeScript support  
✅ **Accessible** - ARIA attributes and semantic HTML  
✅ **Responsive** - Mobile-first design  
✅ **No Dependencies** - Pure React + Tailwind CSS  
✅ **Presentational** - Zero business logic  
✅ **Props-Driven** - Complete control from parent  
✅ **Turkish Localized** - Ready for Turkish UI  
✅ **Vite Compatible** - Works with modern build tools  

---

## Notes

- All components are **uncontrolled by default** but fully controllable via props
- Price calculations should be handled by parent component
- Date/time validation should happen at the parent level
- All components handle their own visual state (hover, focus, active)
- Accessibility is built-in (ARIA labels, semantic HTML)

---

## File Structure

```
/src/components/bookingComponents/
├── index.ts (exports)
├── types.ts (TypeScript interfaces)
├── PrimaryActionButton.tsx
├── DateSelector.tsx
├── TimeSlotGrid.tsx
├── ServiceCard.tsx
├── ServiceCategoryAccordion.tsx
├── BookingInfoForm.tsx
├── BottomPriceSummary.tsx
└── WelcomeSelectorCard.tsx
```

---

**Status:** Production-Ready ✅
