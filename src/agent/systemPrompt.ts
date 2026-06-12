// Agent sistem-prompt assembly. Canonical `buildSystemPrompt`'u (tool kuralları +
// ton + müşteri + güvenlik) REPLİKE eder (channelWebhooks 1687-1745 ile aynı) +
// `tool_request_profile_edit` kuralını ekler (buildSystemPrompt'ta yok — sonradan
// eklenmişti). buildSystemPrompt'a DOKUNMUYORUM (canlı n8n yolu onu kullanıyor).

import {
  buildCustomerCalibration,
  buildSystemPrompt,
  loadCustomerSnapshot,
  loadSalonAgentContext,
} from '../services/salonAgentContext.js';

const PROFILE_EDIT_RULE = [
  '',
  '9. **PROFİL DÜZENLEME** → tool_request_profile_edit ZORUNLU',
  "   Tetikleyiciler: 'numaramı değiştir', 'telefonum değişti', 'bilgilerimi güncelle', 'adımı/ismimi düzelt', 'instagram hesabımı ekle/değiştir', 'profilimi düzenle', 'kayıtlı numaram yanlış'.",
  '   Tool {found:true} dönerse kısa yönlendirme yaz (linki METNE KOYMA, backend buton ekler). {found:false} dönerse müşteri kayıtlı değil — önce randevu alarak kaydolmasını öner.',
].join('\n');

const TRIGGER_TAIL = 'Tetikleyici eşleşirse ve tool çağırmazsan: HATALI cevap üretmiş olursun.';

export async function buildAgentSystemPrompt(input: {
  salonId: number;
  customerId: number | null;
  channelProfileName: string | null;
  registeredName: string | null;
  repliedTo?: Parameters<typeof buildSystemPrompt>[0]['repliedTo'];
}): Promise<string> {
  const agentContext = await loadSalonAgentContext(input.salonId);
  const tone = agentContext?.agentSettings?.tone ?? 'balanced';
  const toneDirective = agentContext?.toneDirective || '';
  const styleDirective = agentContext?.styleDirective || '';
  const salonOneLiner = agentContext?.salonOneLiner || '';
  const salonInfo = agentContext?.salonInfo ?? null;

  const customer = await loadCustomerSnapshot({
    salonId: input.salonId,
    customerId: input.customerId,
    channelProfileName: input.channelProfileName,
    registeredName: input.registeredName,
  });
  const customerCalibration = buildCustomerCalibration(tone, customer);

  const base = buildSystemPrompt({
    toneDirective,
    styleDirective,
    salonOneLiner,
    salonInfo,
    customer,
    customerCalibration,
    repliedTo: input.repliedTo ?? null,
  });

  // Profil-edit kuralını tetikleyici listesinin sonuna ekle (8 → 9).
  return base.includes(TRIGGER_TAIL)
    ? base.replace(TRIGGER_TAIL, `${PROFILE_EDIT_RULE}\n\n${TRIGGER_TAIL}`)
    : `${base}\n${PROFILE_EDIT_RULE}`;
}
