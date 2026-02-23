export interface CategoryDefinition {
  key: string;
  name: string;
}

export const CATEGORIES: Record<string, string> = {
  'FACIAL': 'Yüz & Cilt Bakımı',
  'MEDICAL': 'Medikal Estetik',
  'LASER': 'Lazer Epilasyon',
  'WAX': 'Ağda',
  'BODY': 'Vücut, Şekillendirme & Masaj',
  'NAIL': 'El, Ayak & Tırnak',
  'HAIR': 'Saç & Kuaför',
  'CONSULTATION': 'Danışmanlık & Paketler',
  'OTHER': 'Diğer Hizmetler'
};

export const CATEGORY_ORDER = [
  'FACIAL',
  'MEDICAL',
  'LASER',
  'WAX',
  'BODY',
  'NAIL',
  'HAIR',
  'CONSULTATION',
  'OTHER'
];
