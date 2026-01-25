export interface Client {
  id: string;
  name: string;
  phone: string;
  totalAppointments: number;
  lastVisit: string; // ISO date string
}