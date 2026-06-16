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
  '   {found:true} → kısa yönlendirme yaz (linki METNE KOYMA, backend buton ekler).',
  '   {found:false} → müşteri KAYITLI DEĞİL: "link gönderdim / güncelleyebilirsin" gibi şeyler DEME (link YOK, yalan olur). Nazikçe henüz kaydı olmadığını söyle, randevu alarak kaydolabileceğini öner.',
].join('\n');

const TRIGGER_TAIL = 'Tetikleyici eşleşirse ve tool çağırmazsan: HATALI cevap üretmiş olursun.';

// Veri-çekme tool'larını Gemini Flash sık atlıyor (doğrudan cevaplayıp uyduruyor).
// "Ön bilgin yok" çerçevesi tool-çağırmayı güçlendiriyor.
const NO_PRIOR_KNOWLEDGE = [
  '',
  '# KESİN KURAL — ÖN BİLGİN YOK',
  'Salonun FİYATLARI, KAMPANYALARI, HİZMET LİSTESİ, AÇIK/KAPALI GÜNLERİ ve SSS hakkında HİÇBİR ön bilgin YOK.',
  'Bu konularda tek kelime etmeden ÖNCE ilgili tool\'u çağırmak ZORUNDASIN (fiyat→tool_get_prices, hizmet→tool_get_services, kampanya→tool_get_campaigns, gün-açık→tool_check_day_open, sss→tool_get_faq).',
  'Tool sonucu OLMADAN fiyat/kampanya/saat/hizmet/politika BİLGİSİ verme veya uydurma — kesinlikle yasak. Önce tool, sonra cevap.',
].join('\n');

// Görseli native görebiliyorsun (o anki tur) + geçmiş görsellerin betimi hafızada.
// Model bazen betim hafızada DURURKEN "görsel analizi yapamıyorum" diye reddediyor;
// bu blok onu engeller.
const IMAGE_MEMORY_NOTE = [
  '',
  '# GÖRSEL HAFIZASI',
  'Konuşma geçmişinde "[Müşterinin gönderdiği görsel: ...]" biçiminde notlar görebilirsin —',
  'bunlar müşterinin DAHA ÖNCE gönderdiği görsellerin betimidir ve bilgi olarak SENDE vardır.',
  'Müşteri önceki bir görseli sorarsa BU BETİMLERE dayanarak doğal şekilde cevap ver.',
  '"Görsel analizi yapamıyorum / göremiyorum / sistemim görsel desteklemiyor" gibi şeyleri',
  'ASLA deme — ister o anki görseli görüyorsun, ister geçmişin betimi sende. Reddetme.',
].join('\n');

export async function buildAgentSystemPrompt(input: {
  salonId: number;
  customerId: number | null;
  channelProfileName: string | null;
  registeredName: string | null;
  repliedTo?: Parameters<typeof buildSystemPrompt>[0]['repliedTo'];
  /** Rolling summary — pencere dışı eski turların kalıcı özeti (varsa). */
  conversationSummary?: string | null;
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
    toneName: tone,
  });

  // Profil-edit kuralını tetikleyici listesinin sonuna ekle (8 → 9).
  const withProfileEdit = base.includes(TRIGGER_TAIL)
    ? base.replace(TRIGGER_TAIL, `${PROFILE_EDIT_RULE}\n\n${TRIGGER_TAIL}`)
    : `${base}\n${PROFILE_EDIT_RULE}`;
  // Veri-çekme tool-çağırmayı güçlendiren "ön bilgin yok" bloğu + görsel hafızası.
  let out = `${withProfileEdit}\n${NO_PRIOR_KNOWLEDGE}\n${IMAGE_MEMORY_NOTE}`;

  // Rolling summary — pencere dışında kalan eski turların kalıcı özeti.
  const summary = (input.conversationSummary || '').trim();
  if (summary) {
    out += [
      '',
      '# ÖNCEKİ KONUŞMA ÖZETİ (kalıcı hafıza)',
      'Bu müşteriyle daha önceki yazışmaların özeti aşağıda. Güncel mesajlar ayrıca',
      'verilecek; bu özeti arka-plan bilgisi olarak kullan, müşteriye "özetime göre"',
      'gibi atıf yapma. Çelişki olursa GÜNCEL mesajlar esastır.',
      summary,
    ].join('\n');
  }
  return out;
}
