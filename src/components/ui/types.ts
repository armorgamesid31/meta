export interface Service {
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

export interface Staff {
  id: string;
  name: string;
  emoji: string;
}
