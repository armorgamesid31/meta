import React, { useEffect, useMemo, useState } from 'react';
import SalonLayout from '../../components/SalonLayout';

const SURFACES = [
  'marketing_site',
  'salon_website',
  'booking_page',
  'mobile_app',
  'campaigns',
  'legal',
  'message_templates',
] as const;

const LOCALES = ['tr', 'en', 'es', 'fr', 'de'] as const;

type ContentSurface = (typeof SURFACES)[number];
type LocaleCode = (typeof LOCALES)[number] | string;

interface ContentLocaleValue {
  id: number;
  locale: string;
  draftValue: string;
  publishedValue: string | null;
  status: 'DRAFT' | 'PUBLISHED';
  version: number;
  publishedAt: string | null;
}

interface ContentItem {
  id: number;
  surface: ContentSurface;
  page: string;
  section: string;
  key: string;
  salonId: number | null;
  metadata: Record<string, unknown> | null;
  editable: boolean;
  readOnlyReason: string | null;
  localeValues: ContentLocaleValue[];
}

interface ContentListResponse {
  total: number;
  items: ContentItem[];
}

const STATUS_OPTIONS = ['all', 'DRAFT', 'PUBLISHED'] as const;
type StatusFilter = (typeof STATUS_OPTIONS)[number];

type ScopeFilter = 'default' | 'global' | 'salon' | 'all';

const SalonContent: React.FC = () => {
  const [items, setItems] = useState<ContentItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [bulkPublishing, setBulkPublishing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  const [surfaceFilter, setSurfaceFilter] = useState<string>('all');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [searchFilter, setSearchFilter] = useState('');
  const [pageFilter, setPageFilter] = useState('');
  const [scopeFilter, setScopeFilter] = useState<ScopeFilter>('default');
  const [editLocale, setEditLocale] = useState<LocaleCode>('tr');

  const [activeItem, setActiveItem] = useState<ContentItem | null>(null);
  const [editorDraft, setEditorDraft] = useState('');
  const [selectedItemIds, setSelectedItemIds] = useState<number[]>([]);

  const [createMode, setCreateMode] = useState(false);
  const [createSurface, setCreateSurface] = useState<ContentSurface>('marketing_site');
  const [createPage, setCreatePage] = useState('home');
  const [createSection, setCreateSection] = useState('hero');
  const [createKey, setCreateKey] = useState('title');
  const [createScope, setCreateScope] = useState<'salon' | 'global'>('salon');
  const [createDraft, setCreateDraft] = useState('');

  const currentSalonId = useMemo(() => {
    try {
      const raw = localStorage.getItem('salonUser');
      if (!raw) {
        return null;
      }
      const parsed = JSON.parse(raw);
      const salonId = Number(parsed?.salonId);
      if (!Number.isInteger(salonId) || salonId <= 0) {
        return null;
      }
      return salonId;
    } catch {
      return null;
    }
  }, []);

  const groupedBySurface = useMemo(() => {
    const map: Record<string, ContentItem[]> = {};
    for (const item of items) {
      if (!map[item.surface]) {
        map[item.surface] = [];
      }
      map[item.surface].push(item);
    }
    return map;
  }, [items]);

  useEffect(() => {
    if (!activeItem) {
      setEditorDraft('');
      return;
    }

    const localeValue = activeItem.localeValues.find((row) => row.locale === editLocale);
    setEditorDraft(localeValue?.draftValue || localeValue?.publishedValue || '');
  }, [activeItem, editLocale]);

  useEffect(() => {
    loadItems();
  }, [surfaceFilter, statusFilter, searchFilter, pageFilter, scopeFilter, editLocale]);

  const getAuthHeaders = () => ({
    'Content-Type': 'application/json',
    Authorization: `Bearer ${localStorage.getItem('salonToken') || ''}`,
  });

  const buildQuery = () => {
    const params = new URLSearchParams();

    if (surfaceFilter !== 'all') {
      params.set('surface', surfaceFilter);
    }

    if (statusFilter !== 'all') {
      params.set('status', statusFilter);
    }

    if (searchFilter.trim()) {
      params.set('q', searchFilter.trim());
    }

    if (pageFilter.trim()) {
      params.set('page', pageFilter.trim());
    }

    if (scopeFilter === 'global') {
      params.set('salonId', 'global');
    } else if (scopeFilter === 'salon' && currentSalonId) {
      params.set('salonId', String(currentSalonId));
    } else if (scopeFilter === 'all') {
      params.set('salonId', 'all');
    }

    params.set('locale', String(editLocale));
    params.set('take', '200');

    return params.toString();
  };

  const loadItems = async () => {
    setLoading(true);
    setError(null);

    try {
      const query = buildQuery();
      const response = await fetch(`/api/admin/content/items?${query}`, {
        headers: getAuthHeaders(),
      });

      const data = (await response.json()) as ContentListResponse & { message?: string };

      if (!response.ok) {
        setError(data.message || 'İçerik listesi alınamadı.');
        setItems([]);
        setActiveItem(null);
        return;
      }

      setItems(data.items || []);
      setSelectedItemIds((prev) => prev.filter((itemId) => (data.items || []).some((item) => item.id === itemId)));

      if (activeItem) {
        const refreshed = (data.items || []).find((item) => item.id === activeItem.id) || null;
        setActiveItem(refreshed);
      }
    } catch (loadError) {
      console.error('Error loading content items:', loadError);
      setError('İçerik alınırken bağlantı hatası oluştu.');
    } finally {
      setLoading(false);
    }
  };

  const toggleItemSelection = (itemId: number) => {
    setSelectedItemIds((prev) => {
      if (prev.includes(itemId)) {
        return prev.filter((id) => id !== itemId);
      }
      return [...prev, itemId];
    });
  };

  const onSaveDraft = async () => {
    if (!activeItem) {
      return;
    }

    setSaving(true);
    setError(null);
    setInfo(null);

    try {
      const response = await fetch('/api/admin/content/items/draft', {
        method: 'POST',
        headers: getAuthHeaders(),
        body: JSON.stringify({
          itemId: activeItem.id,
          locale: editLocale,
          draftValue: editorDraft,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        setError(data.message || 'Draft kaydedilemedi.');
        return;
      }

      setInfo('Draft kaydedildi.');
      await loadItems();
    } catch (saveError) {
      console.error('Error saving draft:', saveError);
      setError('Draft kaydedilirken bağlantı hatası oluştu.');
    } finally {
      setSaving(false);
    }
  };

  const onPublish = async () => {
    if (!activeItem) {
      return;
    }

    setPublishing(true);
    setError(null);
    setInfo(null);

    try {
      const response = await fetch('/api/admin/content/items/publish', {
        method: 'POST',
        headers: getAuthHeaders(),
        body: JSON.stringify({
          itemId: activeItem.id,
          locale: editLocale,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        setError(data.message || 'Publish başarısız.');
        return;
      }

      setInfo('İçerik yayınlandı.');
      await loadItems();
    } catch (publishError) {
      console.error('Error publishing content:', publishError);
      setError('Publish sırasında bağlantı hatası oluştu.');
    } finally {
      setPublishing(false);
    }
  };

  const onBulkPublish = async () => {
    if (!selectedItemIds.length) {
      setError('Toplu publish için en az bir içerik seçin.');
      return;
    }

    setBulkPublishing(true);
    setError(null);
    setInfo(null);

    try {
      const entries = selectedItemIds.map((itemId) => ({ itemId, locale: editLocale }));
      const response = await fetch('/api/admin/content/items/publish-bulk', {
        method: 'POST',
        headers: getAuthHeaders(),
        body: JSON.stringify({ entries }),
      });

      const data = await response.json();

      if (!response.ok) {
        setError(data.message || 'Toplu publish başarısız.');
        return;
      }

      const publishedCount = Array.isArray(data.published) ? data.published.length : 0;
      const skippedCount = Array.isArray(data.skipped) ? data.skipped.length : 0;
      setInfo(`Toplu publish tamamlandı. Yayınlanan: ${publishedCount}, Atlanan: ${skippedCount}`);
      await loadItems();
    } catch (bulkError) {
      console.error('Error bulk publishing:', bulkError);
      setError('Toplu publish sırasında bağlantı hatası oluştu.');
    } finally {
      setBulkPublishing(false);
    }
  };

  const onCreateDraft = async () => {
    if (!createPage.trim() || !createSection.trim() || !createKey.trim()) {
      setError('Yeni içerik için page, section ve key zorunludur.');
      return;
    }

    if (!createDraft.trim()) {
      setError('Yeni içerik için draft metni girin.');
      return;
    }

    setSaving(true);
    setError(null);
    setInfo(null);

    try {
      const response = await fetch('/api/admin/content/items/draft', {
        method: 'POST',
        headers: getAuthHeaders(),
        body: JSON.stringify({
          surface: createSurface,
          page: createPage.trim(),
          section: createSection.trim(),
          key: createKey.trim(),
          locale: editLocale,
          salonId: createScope === 'global' ? null : currentSalonId,
          draftValue: createDraft,
        }),
      });

      const data = await response.json();
      if (!response.ok) {
        setError(data.message || 'Yeni içerik oluşturulamadı.');
        return;
      }

      setInfo('Yeni içerik draft olarak eklendi.');
      setCreateMode(false);
      setCreateDraft('');
      await loadItems();
    } catch (createError) {
      console.error('Error creating content draft:', createError);
      setError('Yeni içerik oluşturulurken bağlantı hatası oluştu.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <SalonLayout>
      <div className="px-4 py-6 sm:px-0 space-y-6">
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">İçerik Yönetimi</h1>
            <p className="text-sm text-gray-600">Surface bazlı çok dilli draft/publish yönetimi</p>
          </div>

          <div className="flex flex-wrap gap-2">
            <button
              onClick={() => setCreateMode((prev) => !prev)}
              className="px-3 py-2 rounded-md bg-gray-100 border border-gray-300 text-sm hover:bg-gray-200"
            >
              {createMode ? 'Yeni Kayıt Formunu Kapat' : 'Yeni Kayıt Ekle'}
            </button>
            <button
              onClick={onBulkPublish}
              disabled={bulkPublishing || !selectedItemIds.length}
              className="px-3 py-2 rounded-md bg-blue-600 text-white text-sm disabled:bg-gray-400"
            >
              {bulkPublishing ? 'Yayınlanıyor...' : `Seçilileri Yayınla (${selectedItemIds.length})`}
            </button>
          </div>
        </div>

        <div className="bg-white rounded-lg border p-4 grid grid-cols-1 md:grid-cols-6 gap-3">
          <select
            value={surfaceFilter}
            onChange={(e) => setSurfaceFilter(e.target.value)}
            className="border rounded-md px-3 py-2 text-sm"
          >
            <option value="all">Tüm Surface</option>
            {SURFACES.map((surface) => (
              <option key={surface} value={surface}>
                {surface}
              </option>
            ))}
          </select>

          <select
            value={editLocale}
            onChange={(e) => setEditLocale(e.target.value)}
            className="border rounded-md px-3 py-2 text-sm"
          >
            {LOCALES.map((locale) => (
              <option key={locale} value={locale}>
                Locale: {locale}
              </option>
            ))}
          </select>

          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as StatusFilter)}
            className="border rounded-md px-3 py-2 text-sm"
          >
            <option value="all">Tüm Status</option>
            <option value="DRAFT">DRAFT</option>
            <option value="PUBLISHED">PUBLISHED</option>
          </select>

          <select
            value={scopeFilter}
            onChange={(e) => setScopeFilter(e.target.value as ScopeFilter)}
            className="border rounded-md px-3 py-2 text-sm"
          >
            <option value="default">Scope: Global + Benim Salon</option>
            <option value="global">Scope: Sadece Global</option>
            <option value="salon">Scope: Sadece Benim Salon</option>
            <option value="all">Scope: Tümü (Allowlist)</option>
          </select>

          <input
            type="text"
            value={pageFilter}
            onChange={(e) => setPageFilter(e.target.value)}
            placeholder="Page filtresi"
            className="border rounded-md px-3 py-2 text-sm"
          />

          <input
            type="text"
            value={searchFilter}
            onChange={(e) => setSearchFilter(e.target.value)}
            placeholder="Ara (q)"
            className="border rounded-md px-3 py-2 text-sm"
          />
        </div>

        {createMode && (
          <div className="bg-white rounded-lg border p-4 space-y-3">
            <h2 className="text-sm font-semibold text-gray-900">Yeni İçerik Draft</h2>

            <div className="grid grid-cols-1 md:grid-cols-5 gap-3">
              <select
                value={createSurface}
                onChange={(e) => setCreateSurface(e.target.value as ContentSurface)}
                className="border rounded-md px-3 py-2 text-sm"
              >
                {SURFACES.map((surface) => (
                  <option key={surface} value={surface}>
                    {surface}
                  </option>
                ))}
              </select>

              <input
                type="text"
                value={createPage}
                onChange={(e) => setCreatePage(e.target.value)}
                placeholder="page"
                className="border rounded-md px-3 py-2 text-sm"
              />
              <input
                type="text"
                value={createSection}
                onChange={(e) => setCreateSection(e.target.value)}
                placeholder="section"
                className="border rounded-md px-3 py-2 text-sm"
              />
              <input
                type="text"
                value={createKey}
                onChange={(e) => setCreateKey(e.target.value)}
                placeholder="key"
                className="border rounded-md px-3 py-2 text-sm"
              />

              <select
                value={createScope}
                onChange={(e) => setCreateScope(e.target.value as 'salon' | 'global')}
                className="border rounded-md px-3 py-2 text-sm"
              >
                <option value="salon">Salon Scope</option>
                <option value="global">Global Scope</option>
              </select>
            </div>

            <textarea
              value={createDraft}
              onChange={(e) => setCreateDraft(e.target.value)}
              rows={3}
              placeholder="Draft metni"
              className="w-full border rounded-md px-3 py-2 text-sm"
            />

            <div className="flex justify-end">
              <button
                onClick={onCreateDraft}
                disabled={saving}
                className="px-3 py-2 rounded-md bg-blue-600 text-white text-sm disabled:bg-gray-400"
              >
                {saving ? 'Kaydediliyor...' : 'Draft Olarak Ekle'}
              </button>
            </div>
          </div>
        )}

        {error && <div className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-md p-3">{error}</div>}
        {info && <div className="text-sm text-green-700 bg-green-50 border border-green-200 rounded-md p-3">{info}</div>}

        {loading ? (
          <div className="bg-white rounded-lg border p-8 text-center text-gray-500">Yükleniyor...</div>
        ) : (
          <div className="space-y-4">
            {Object.keys(groupedBySurface).length === 0 ? (
              <div className="bg-white rounded-lg border p-8 text-center text-gray-500">Kriterlere uygun içerik bulunamadı.</div>
            ) : (
              Object.keys(groupedBySurface)
                .sort((a, b) => a.localeCompare(b))
                .map((surface) => (
                  <div key={surface} className="bg-white rounded-lg border overflow-hidden">
                    <div className="px-4 py-3 border-b bg-gray-50">
                      <h3 className="text-sm font-semibold text-gray-900">{surface}</h3>
                    </div>

                    <div className="overflow-x-auto">
                      <table className="min-w-full text-sm">
                        <thead className="bg-white border-b">
                          <tr>
                            <th className="text-left px-3 py-2 w-10"></th>
                            <th className="text-left px-3 py-2">Key</th>
                            <th className="text-left px-3 py-2">Scope</th>
                            <th className="text-left px-3 py-2">Locale Status</th>
                            <th className="text-left px-3 py-2">Draft (kısa)</th>
                            <th className="text-left px-3 py-2">Published (kısa)</th>
                            <th className="text-left px-3 py-2">Aksiyon</th>
                          </tr>
                        </thead>
                        <tbody>
                          {groupedBySurface[surface].map((item) => {
                            const localeValue = item.localeValues.find((value) => value.locale === editLocale);
                            const draftPreview = (localeValue?.draftValue || '').slice(0, 70);
                            const publishedPreview = (localeValue?.publishedValue || '').slice(0, 70);
                            const selected = selectedItemIds.includes(item.id);

                            return (
                              <tr key={item.id} className="border-b last:border-b-0">
                                <td className="px-3 py-2">
                                  <input
                                    type="checkbox"
                                    checked={selected}
                                    onChange={() => toggleItemSelection(item.id)}
                                  />
                                </td>
                                <td className="px-3 py-2 font-mono text-xs">
                                  {item.page}.{item.section}.{item.key}
                                </td>
                                <td className="px-3 py-2">{item.salonId ? `Salon #${item.salonId}` : 'Global'}</td>
                                <td className="px-3 py-2">{localeValue?.status || 'NONE'}</td>
                                <td className="px-3 py-2 text-gray-700">{draftPreview || '-'}</td>
                                <td className="px-3 py-2 text-gray-700">{publishedPreview || '-'}</td>
                                <td className="px-3 py-2">
                                  <button
                                    onClick={() => setActiveItem(item)}
                                    className="px-2 py-1 border rounded text-xs hover:bg-gray-100"
                                  >
                                    Düzenle
                                  </button>
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  </div>
                ))
            )}
          </div>
        )}

        {activeItem && (
          <div className="bg-white rounded-lg border p-4 space-y-3">
            <div className="flex justify-between items-start gap-2">
              <div>
                <h3 className="text-sm font-semibold text-gray-900">Aktif Kayıt</h3>
                <p className="text-xs text-gray-600 font-mono">
                  {activeItem.surface}.{activeItem.page}.{activeItem.section}.{activeItem.key}
                </p>
                <p className="text-xs text-gray-500">Scope: {activeItem.salonId ? `Salon #${activeItem.salonId}` : 'Global'}</p>
              </div>
              <button
                onClick={() => setActiveItem(null)}
                className="px-2 py-1 border rounded text-xs hover:bg-gray-100"
              >
                Kapat
              </button>
            </div>

            {activeItem.readOnlyReason ? (
              <div className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded p-2">{activeItem.readOnlyReason}</div>
            ) : null}

            <textarea
              value={editorDraft}
              onChange={(e) => setEditorDraft(e.target.value)}
              rows={6}
              className="w-full border rounded-md px-3 py-2 text-sm"
              disabled={!activeItem.editable || !!activeItem.readOnlyReason}
            />

            <div className="flex justify-end gap-2">
              <button
                onClick={onSaveDraft}
                disabled={saving || !activeItem.editable || !!activeItem.readOnlyReason}
                className="px-3 py-2 rounded-md border text-sm hover:bg-gray-100 disabled:bg-gray-100"
              >
                {saving ? 'Kaydediliyor...' : 'Draft Kaydet'}
              </button>
              <button
                onClick={onPublish}
                disabled={publishing || !activeItem.editable || !!activeItem.readOnlyReason}
                className="px-3 py-2 rounded-md bg-green-600 text-white text-sm disabled:bg-gray-400"
              >
                {publishing ? 'Yayınlanıyor...' : 'Yayınla'}
              </button>
            </div>
          </div>
        )}
      </div>
    </SalonLayout>
  );
};

export default SalonContent;
