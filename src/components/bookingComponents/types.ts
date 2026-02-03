// Booking flow data types
export interface TimeSlot {
  id: string;
  time: string;
  available: boolean;
}

export interface Service {
  id: string;
  name: string;
  description?: string;
  duration: number; // in minutes
  price: number;
}

export interface ServiceCategory {
  id: string;
  name: string;
  icon?: string;
  services: Service[];
}

export interface BookingState {
  selectedDate?: Date;
  selectedTime?: string;
  selectedServices: Service[];
  customerInfo?: {
    name: string;
    phone: string;
    gender: 'male' | 'female' | 'other';
    birthDate?: string;
  };
}

export interface PriceBreakdown {
  subtotal: number;
  discount?: number;
  tax?: number;
  total: number;
}
