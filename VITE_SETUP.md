# Vite + React 19 Booking Components

This is a **pure React 19 + Vite** project with Tailwind CSS v4. No Next.js, no global CSS assumptions.

## Architecture

- **Framework**: React 19 (Vite)
- **Styling**: Tailwind CSS v4 (zero custom global CSS)
- **Components**: Located in `/src/components/bookingComponents/`
- **Build Tool**: Vite (not Next.js)

## Key Points

### ✅ What's Included

1. **8 Presentational Components**
   - `PrimaryActionButton` - CTA with loading states
   - `DateSelector` - Horizontal scrollable date picker
   - `TimeSlotGrid` - 3-column time slot grid
   - `ServiceCard` - Individual service with checkbox & price
   - `ServiceCategoryAccordion` - Multi-service accordion
   - `BookingInfoForm` - Customer info form (name, phone, gender, birth date)
   - `BottomPriceSummary` - Sticky footer with price breakdown
   - `WelcomeSelectorCard` - Complete booking flow component

2. **Type Definitions** (`/src/components/bookingComponents/types.ts`)
   - `TimeSlot`
   - `Service`
   - `ServiceCategory`
   - `BookingState`
   - `PriceBreakdown`

3. **Demo Page** (`/src/pages/ComponentShowcase.tsx`)
   - Live examples of all components
   - Sample data and state management patterns

### ❌ What's NOT Included

- No Next.js-specific code
- No global CSS variables
- No environment variable assumptions
- No routing libraries (use your own router or Vite)
- No state management (components are presentational)

## Component Usage

All components are **props-driven** and **presentational**. Import and use them directly:

```tsx
import {
  DateSelector,
  TimeSlotGrid,
  ServiceCategoryAccordion,
  BottomPriceSummary,
} from './components/bookingComponents';

// Use in your component
<DateSelector
  dates={myDates}
  selectedDateId={selected}
  onSelectDate={(id) => setSelected(id)}
/>
```

## Styling

- All components use **Tailwind utility classes only**
- Color palette is built-in (gold/amber primary #C9A961)
- No component-scoped CSS or CSS-in-JS
- Your existing Tailwind config is fully compatible

## Extending Components

To customize styles, simply pass additional Tailwind classes via `className` props or modify the component JSX directly. The components are simple and readable.

## Integration with Backend

The components emit events and expose typed interfaces for integration:

```tsx
<ServiceCard
  service={service}
  isSelected={isSelected}
  onSelect={(service) => {
    // Send to your API
    bookingAPI.addService(service);
  }}
/>
```

See `COMPONENTS.md` for detailed API documentation for each component.

## No Build Issues

- No CSS variable dependencies
- No global style assumptions
- No Next.js-specific imports
- Fully compatible with Vite's PostCSS/Tailwind pipeline
