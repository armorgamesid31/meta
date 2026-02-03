# Magic Link Booking Components

## Overview
Complete set of 8 presentational UI components for a single-page Magic Link booking flow. All components are fully typed TypeScript, props-driven, and support theme customization.

---

## Component Specifications

### 1. **WelcomeSelectorCard**
**File:** `WelcomeSelectorCard.tsx`
**Purpose:** Optional welcome card with gender/menu selection

**Props:**
```typescript
interface WelcomeSelectorCardProps {
  onSelectGender: (gender: 'woman' | 'man') => void;
  primaryColor?: string;          // Default: '#BC952B'
  secondaryColor?: string;        // Default: '#2D2D2D'
  borderRadius?: string;          // Default: '20px'
}
```

**Features:**
- Gender selection buttons (Kadın/Erkek)
- Customizable colors for primary/secondary buttons
- Icon support with emojis
- Full-width responsive design

---

### 2. **ServiceCategoryAccordion**
**File:** `ServiceAccordion.tsx` (existing)
**Purpose:** Collapsible service category container

**Props:**
```typescript
interface ServiceAccordionProps {
  categoryName: string;
  icon: string;
  serviceCount: number;
  isOpen: boolean;
  onToggle: () => void;
  children: ReactNode;
}
```

**Features:**
- Expandable/collapsible sections
- Service count badge
- Smooth animations
- Icon support

---

### 3. **ServiceCard**
**File:** `ServiceCard.tsx` (existing)
**Purpose:** Individual service selection card with options

**Props:**
```typescript
interface ServiceCardProps {
  service: Service;
  isSelected: boolean;
  selectedStaffId?: string;
  staffOptions: Staff[];
  onToggle: () => void;
  onToggleGuest: () => void;
  onTogglePackage: () => void;
  onStaffSelect: (staffId: string) => void;
}
```

**Features:**
- Add/Remove service functionality
- Staff selector dropdown
- Guest/Package toggles
- Price display with discounts
- Package availability badges

---

### 4. **DateSelector**
**File:** `DateSelector.tsx` (existing)
**Purpose:** Date selection with horizontal scroll

**Props:**
```typescript
interface DateSelectorProps {
  dates: DateObj[];
  selectedDate?: string;
  onDateSelect: (date: string) => void;
  showWaitlist?: boolean;
  waitlistSubmitted?: boolean;
  onWaitlistSubmit?: () => void;
}
```

**Features:**
- Horizontal date grid
- Availability indicators
- Waitlist UI (optional)
- Smooth transitions

---

### 5. **TimeSlotGrid**
**File:** `TimeGrid.tsx` (existing)
**Purpose:** Time slot selection grid

**Props:**
```typescript
interface TimeGridProps {
  timeSlots: TimeSlots;           // {morning, afternoon, evening}
  selectedTime?: string;
  onTimeSelect: (time: string) => void;
  totalDuration?: number;         // in minutes
}
```

**Features:**
- 3-column grid layout
- Time period sections (Sabah/Öğle/Akşam)
- End time calculation
- Duration display

---

### 6. **BookingInfoForm**
**File:** `BookingInfoForm.tsx` (new)
**Purpose:** Inline appointment details form

**Props:**
```typescript
interface BookingInfoFormProps {
  name?: string;
  phone?: string;
  birthDate?: string;
  gender?: 'woman' | 'man';
  onNameChange?: (name: string) => void;
  onPhoneChange?: (phone: string) => void;
  onBirthDateChange?: (date: string) => void;
  onGenderChange?: (gender: 'woman' | 'man') => void;
  primaryColor?: string;          // Default: '#BC952B'
  accentColor?: string;           // Default: '#10B981'
  borderRadius?: string;          // Default: '24px'
}
```

**Features:**
- Name, phone, birthdate fields
- Auto-formatted phone input
- Gender selection buttons
- Privacy checkbox
- Error state support
- Icon-labeled fields

---

### 7. **BottomPriceSummary** (StickyPriceFooter)
**File:** `StickyPriceFooter.tsx` (existing)
**Purpose:** Fixed bottom price and confirmation

**Props:**
```typescript
interface StickyPriceFooterProps {
  originalPrice: number;
  finalPrice: number;
  showDiscount: boolean;
  isEnabled: boolean;
  onConfirm: () => void;
  onShowBreakdown: () => void;
}
```

**Features:**
- Sticky bottom positioning
- Price display with breakdown
- Confirm button state management
- Discount indication

---

### 8. **PrimaryActionButton**
**File:** `PrimaryActionButton.tsx` (new)
**Purpose:** Reusable primary action button

**Props:**
```typescript
interface PrimaryActionButtonProps {
  children: ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  loading?: boolean;
  variant?: 'solid' | 'outline';
  size?: 'sm' | 'md' | 'lg';
  fullWidth?: boolean;
  primaryColor?: string;          // Default: '#BC952B'
  buttonVariant?: 'rounded' | 'pill';
  className?: string;
}
```

**Features:**
- Solid and outline variants
- 3 size options (sm/md/lg)
- Loading state with spinner
- Full-width option
- Customizable border radius
- Color theming support

---

## Type Definitions

### Service Type (types.ts)
```typescript
interface Service {
  id: string;
  name: string;
  duration: string;
  durationMinutes: number;
  price: number;
  discountedPrice?: number;
  forGuest?: boolean;
  usePackage?: boolean;
  packageSessionsLeft?: number;
  packageAvailable?: boolean;
  hasSynergy?: boolean;
  synergyBadge?: string;
}
```

### Staff Type (types.ts)
```typescript
interface Staff {
  id: string;
  name: string;
  emoji: string;
}
```

---

## Design System

**Color Palette:**
- Primary: #BC952B (Gold)
- Secondary: #2D2D2D (Dark)
- Success: #10B981 (Green)
- Background: #FAFAFA (Off-white)
- Text: #1a1a1a (Dark gray)
- Border: #E5E7EB (Light gray)

**Border Radius Options:**
- Cards: 24px
- Fields: 16px
- Buttons: 18px
- Pill buttons: 9999px

**Typography:**
- Headings: Bold 15px
- Body: Regular 14px
- Labels: Bold 12px
- Small: Bold 11px

---

## Integration Example

```typescript
import { WelcomeSelectorCard } from './WelcomeSelectorCard';
import { ServiceAccordion } from './ServiceAccordion';
import { ServiceCard } from './ServiceCard';
import { DateSelector } from './DateSelector';
import { TimeGrid } from './TimeGrid';
import { BookingInfoForm } from './BookingInfoForm';
import { StickyPriceFooter } from './StickyPriceFooter';
import { PrimaryActionButton } from './PrimaryActionButton';

export default function MagicLinkBooking() {
  // All components imported and ready to use
  // See /src/pages/MagicLinkBooking.tsx for full implementation
}
```

---

## Constraints Compliance

✅ Pure presentational components
✅ No side effects
✅ No data fetching
✅ TypeScript fully typed
✅ Props-driven only
✅ Tailwind CSS utilities only
✅ No inline styles (except CSS variables)
✅ Theme customization support
✅ No hardcoded backend assumptions
✅ React 19 compatible
