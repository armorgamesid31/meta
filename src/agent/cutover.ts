// W6 cutover gate. Hangi salonun inbound'u backend-native agent'a (n8n yerine)
// gideceğini ENV ile seçer — schema/migration YOK, Coolify env ile tek salon flip.
//
//   AGENT_BACKEND_SALON_IDS="8"        → sadece salon 8 backend (canary)
//   AGENT_BACKEND_SALON_IDS="8,12,30"  → bu salonlar backend
//   AGENT_BACKEND_SALON_IDS="*"        → tüm salonlar backend (tam geçiş)
//   (boş/yok)                          → hiçbiri; herkes n8n (varsayılan, canlı dokunulmaz)
//
// Env runtime'da okunur (process restart'ta yeni değer); küçük liste, cache gereksiz.

function parseList(): { all: boolean; ids: Set<number> } {
  const raw = (process.env.AGENT_BACKEND_SALON_IDS || '').trim();
  if (!raw) return { all: false, ids: new Set() };
  if (raw === '*') return { all: true, ids: new Set() };
  const ids = new Set<number>();
  for (const part of raw.split(',')) {
    const n = Number(part.trim());
    if (Number.isInteger(n) && n > 0) ids.add(n);
  }
  return { all: false, ids };
}

/** Bu salon backend-native agent kullanıyor mu? */
export function isBackendEngine(salonId: number): boolean {
  const { all, ids } = parseList();
  return all || ids.has(salonId);
}
