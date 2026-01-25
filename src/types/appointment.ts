export interface Appointment {
  id: string;
  clientName: string;
  service: string;
  date: string; // ISO date string
  time: string; // HH:MM format
  status: 'confirmed' | 'pending' | 'cancelled';
}