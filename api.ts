// Cliente do catálogo de cartas (séries/coleções). Toda a lógica de acesso à Pokemon TCG API
// (incluindo a chave de API e os dados de contingência) vive agora no backend — este arquivo
// só fala com o nosso próprio servidor, nunca diretamente com serviços externos.

const API_BASE = (import.meta as any).env?.VITE_API_URL || '/api';

const fetchWithTimeout = async (url: string, timeout = 8000): Promise<Response> => {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeout);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: { Accept: 'application/json' },
    });
    if (!response.ok) {
      throw new Error(`API Error: ${response.status} ${response.statusText}`);
    }
    return response;
  } finally {
    clearTimeout(id);
  }
};

// FETCH SETS WITH CLIENT-SIDE SWR CACHING (o backend já cacheia/faz fallback do lado dele)
export const fetchSets = async () => {
  const CACHE_KEY = 'poketracker_cache_sets';

  let cachedData: any[] | null = null;
  try {
    const item = localStorage.getItem(CACHE_KEY);
    if (item) cachedData = JSON.parse(item);
  } catch (e) {
    console.warn('Could not read sets cache:', e);
  }

  if (cachedData && Array.isArray(cachedData) && cachedData.length > 0) {
    // Revalida em segundo plano, sem bloquear a UI
    fetchWithTimeout(`${API_BASE}/tcg/sets`)
      .then((res) => res.json())
      .then((body) => {
        if (body?.data) {
          localStorage.setItem(CACHE_KEY, JSON.stringify(body.data));
        }
      })
      .catch((err) => console.warn('Background sets sync skipped/failed:', err.message));

    return cachedData;
  }

  try {
    const response = await fetchWithTimeout(`${API_BASE}/tcg/sets`, 8000);
    const body = await response.json();
    if (!body?.data) throw new Error('Invalid data format received from backend');

    try {
      localStorage.setItem(CACHE_KEY, JSON.stringify(body.data));
    } catch (e) {
      console.warn('Could not write sets cache:', e);
    }

    return body.data;
  } catch (error) {
    console.error('Error fetching sets from backend:', error);
    return [];
  }
};

// FETCH CARDS WITH CLIENT-SIDE SWR CACHING
export const fetchCardsBySet = async (setId: string, skipBackgroundSync = false) => {
  const CACHE_KEY = `poketracker_cache_cards_${setId}`;

  let cachedData: any[] | null = null;
  try {
    const item = localStorage.getItem(CACHE_KEY);
    if (item) cachedData = JSON.parse(item);
  } catch (e) {
    console.warn('Could not read cards cache:', e);
  }

  if (cachedData && Array.isArray(cachedData) && cachedData.length > 0) {
    if (!skipBackgroundSync) {
      fetchWithTimeout(`${API_BASE}/tcg/cards/${encodeURIComponent(setId)}`)
        .then((res) => res.json())
        .then((body) => {
          if (body?.data) {
            localStorage.setItem(CACHE_KEY, JSON.stringify(body.data));
          }
        })
        .catch((err) => console.warn(`Background cards sync for ${setId} skipped/failed:`, err.message));
    }

    return cachedData;
  }

  try {
    const response = await fetchWithTimeout(`${API_BASE}/tcg/cards/${encodeURIComponent(setId)}`, 8000);
    const body = await response.json();
    if (!body?.data) throw new Error('Invalid data format received from backend');

    try {
      localStorage.setItem(CACHE_KEY, JSON.stringify(body.data));
    } catch (e) {
      console.warn('Could not write cards cache:', e);
    }

    return body.data;
  } catch (error: any) {
    console.warn(`Error fetching cards for set ${setId}: ${error?.message || error}.`);
    return [];
  }
};
