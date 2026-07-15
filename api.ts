const API_BASE = 'https://api.pokemontcg.io/v2';

// FALLBACK DATA (Offline-first & Resiliency)
const FALLBACK_SETS = [
  {
    id: 'sv1',
    name: 'Scarlet & Violet',
    series: 'Scarlet & Violet',
    printedTotal: 198,
    total: 258,
    logoUrl: 'https://images.pokemontcg.io/sv1/logo.png',
    symbolUrl: 'https://images.pokemontcg.io/sv1/symbol.png',
    releaseDate: '2023-03-31',
    updatedAt: '2023-03-31'
  },
  {
    id: 'sv3pt5',
    name: '151',
    series: 'Scarlet & Violet',
    printedTotal: 165,
    total: 207,
    logoUrl: 'https://images.pokemontcg.io/sv3pt5/logo.png',
    symbolUrl: 'https://images.pokemontcg.io/sv3pt5/symbol.png',
    releaseDate: '2023-09-22',
    updatedAt: '2023-09-22'
  },
  {
    id: 'swsh12',
    name: 'Silver Tempest',
    series: 'Sword & Shield',
    printedTotal: 195,
    total: 245,
    logoUrl: 'https://images.pokemontcg.io/swsh12/logo.png',
    symbolUrl: 'https://images.pokemontcg.io/swsh12/symbol.png',
    releaseDate: '2022-11-11',
    updatedAt: '2022-11-11'
  },
  {
    id: 'swsh11',
    name: 'Lost Origin',
    series: 'Sword & Shield',
    printedTotal: 196,
    total: 247,
    logoUrl: 'https://images.pokemontcg.io/swsh11/logo.png',
    symbolUrl: 'https://images.pokemontcg.io/swsh11/symbol.png',
    releaseDate: '2022-09-09',
    updatedAt: '2022-09-09'
  },
  {
    id: 'swsh9',
    name: 'Brilliant Stars',
    series: 'Sword & Shield',
    printedTotal: 172,
    total: 186,
    logoUrl: 'https://images.pokemontcg.io/swsh9/logo.png',
    symbolUrl: 'https://images.pokemontcg.io/swsh9/symbol.png',
    releaseDate: '2022-02-25',
    updatedAt: '2022-02-25'
  },
  {
    id: 'base1',
    name: 'Base Set',
    series: 'Base',
    printedTotal: 102,
    total: 102,
    logoUrl: 'https://images.pokemontcg.io/base1/logo.png',
    symbolUrl: 'https://images.pokemontcg.io/base1/symbol.png',
    releaseDate: '1999-01-09',
    updatedAt: '1999-01-09'
  },
  {
    id: 'base2',
    name: 'Jungle',
    series: 'Base',
    printedTotal: 64,
    total: 64,
    logoUrl: 'https://images.pokemontcg.io/base2/logo.png',
    symbolUrl: 'https://images.pokemontcg.io/base2/symbol.png',
    releaseDate: '1999-06-16',
    updatedAt: '1999-06-16'
  },
  {
    id: 'base3',
    name: 'Fossil',
    series: 'Base',
    printedTotal: 62,
    total: 62,
    logoUrl: 'https://images.pokemontcg.io/base3/logo.png',
    symbolUrl: 'https://images.pokemontcg.io/base3/symbol.png',
    releaseDate: '1999-10-10',
    updatedAt: '1999-10-10'
  }
];

const FALLBACK_CARDS: Record<string, any[]> = {
  'base1': [
    {
      id: 'base1-4',
      name: 'Charizard',
      imageUrl: 'https://images.pokemontcg.io/base1/4.png',
      imageUrlHiRes: 'https://images.pokemontcg.io/base1/4_hires.png',
      number: '4',
      rarity: 'Rare Holo',
      isSecret: false,
      marketPrice: 350.00,
      set: { id: 'base1', name: 'Base Set', printedTotal: 102 }
    },
    {
      id: 'base1-2',
      name: 'Blastoise',
      imageUrl: 'https://images.pokemontcg.io/base1/2.png',
      imageUrlHiRes: 'https://images.pokemontcg.io/base1/2_hires.png',
      number: '2',
      rarity: 'Rare Holo',
      isSecret: false,
      marketPrice: 120.00,
      set: { id: 'base1', name: 'Base Set', printedTotal: 102 }
    },
    {
      id: 'base1-15',
      name: 'Venusaur',
      imageUrl: 'https://images.pokemontcg.io/base1/15.png',
      imageUrlHiRes: 'https://images.pokemontcg.io/base1/15_hires.png',
      number: '15',
      rarity: 'Rare Holo',
      isSecret: false,
      marketPrice: 85.00,
      set: { id: 'base1', name: 'Base Set', printedTotal: 102 }
    },
    {
      id: 'base1-58',
      name: 'Pikachu',
      imageUrl: 'https://images.pokemontcg.io/base1/58.png',
      imageUrlHiRes: 'https://images.pokemontcg.io/base1/58_hires.png',
      number: '58',
      rarity: 'Common',
      isSecret: false,
      marketPrice: 2.50,
      set: { id: 'base1', name: 'Base Set', printedTotal: 102 }
    },
    {
      id: 'base1-10',
      name: 'Mewtwo',
      imageUrl: 'https://images.pokemontcg.io/base1/10.png',
      imageUrlHiRes: 'https://images.pokemontcg.io/base1/10_hires.png',
      number: '10',
      rarity: 'Rare Holo',
      isSecret: false,
      marketPrice: 35.00,
      set: { id: 'base1', name: 'Base Set', printedTotal: 102 }
    },
    {
      id: 'base1-1',
      name: 'Alakazam',
      imageUrl: 'https://images.pokemontcg.io/base1/1.png',
      imageUrlHiRes: 'https://images.pokemontcg.io/base1/1_hires.png',
      number: '1',
      rarity: 'Rare Holo',
      isSecret: false,
      marketPrice: 42.00,
      set: { id: 'base1', name: 'Base Set', printedTotal: 102 }
    },
    {
      id: 'base1-6',
      name: 'Gyarados',
      imageUrl: 'https://images.pokemontcg.io/base1/6.png',
      imageUrlHiRes: 'https://images.pokemontcg.io/base1/6_hires.png',
      number: '6',
      rarity: 'Rare Holo',
      isSecret: false,
      marketPrice: 28.00,
      set: { id: 'base1', name: 'Base Set', printedTotal: 102 }
    }
  ],
  'sv3pt5': [
    {
      id: 'sv3pt5-1',
      name: 'Bulbasaur',
      imageUrl: 'https://images.pokemontcg.io/sv3pt5/1.png',
      imageUrlHiRes: 'https://images.pokemontcg.io/sv3pt5/1_hires.png',
      number: '1',
      rarity: 'Common',
      isSecret: false,
      marketPrice: 0.50,
      set: { id: 'sv3pt5', name: '151', printedTotal: 165 }
    },
    {
      id: 'sv3pt5-4',
      name: 'Charmander',
      imageUrl: 'https://images.pokemontcg.io/sv3pt5/4.png',
      imageUrlHiRes: 'https://images.pokemontcg.io/sv3pt5/4_hires.png',
      number: '4',
      rarity: 'Common',
      isSecret: false,
      marketPrice: 1.20,
      set: { id: 'sv3pt5', name: '151', printedTotal: 165 }
    },
    {
      id: 'sv3pt5-7',
      name: 'Squirtle',
      imageUrl: 'https://images.pokemontcg.io/sv3pt5/7.png',
      imageUrlHiRes: 'https://images.pokemontcg.io/sv3pt5/7_hires.png',
      number: '7',
      rarity: 'Common',
      isSecret: false,
      marketPrice: 0.80,
      set: { id: 'sv3pt5', name: '151', printedTotal: 165 }
    },
    {
      id: 'sv3pt5-25',
      name: 'Pikachu',
      imageUrl: 'https://images.pokemontcg.io/sv3pt5/25.png',
      imageUrlHiRes: 'https://images.pokemontcg.io/sv3pt5/25_hires.png',
      number: '25',
      rarity: 'Common',
      isSecret: false,
      marketPrice: 1.50,
      set: { id: 'sv3pt5', name: '151', printedTotal: 165 }
    },
    {
      id: 'sv3pt5-199',
      name: 'Charizard ex',
      imageUrl: 'https://images.pokemontcg.io/sv3pt5/199.png',
      imageUrlHiRes: 'https://images.pokemontcg.io/sv3pt5/199_hires.png',
      number: '199',
      rarity: 'Rare Special Illustration',
      isSecret: true,
      marketPrice: 120.00,
      set: { id: 'sv3pt5', name: '151', printedTotal: 165 }
    },
    {
      id: 'sv3pt5-205',
      name: 'Mew ex',
      imageUrl: 'https://images.pokemontcg.io/sv3pt5/205.png',
      imageUrlHiRes: 'https://images.pokemontcg.io/sv3pt5/205_hires.png',
      number: '205',
      rarity: 'Rare Hyper',
      isSecret: true,
      marketPrice: 85.00,
      set: { id: 'sv3pt5', name: '151', printedTotal: 165 }
    }
  ]
};

const generateMockCards = (setId: string, setName: string, total = 9) => {
  const pokemonNames = ['Charizard', 'Pikachu', 'Mewtwo', 'Blastoise', 'Venusaur', 'Alakazam', 'Lugia', 'Gengar', 'Rayquaza', 'Eevee', 'Mew', 'Lucario', 'Gardevoir', 'Gyarados'];
  const rarities = ['Common', 'Uncommon', 'Rare Holo', 'Rare Ultra', 'Rare Secret'];
  
  const cards = [];
  for (let i = 1; i <= total; i++) {
    const name = pokemonNames[(i - 1) % pokemonNames.length];
    const isSecret = i > Math.floor(total * 0.85);
    const rarity = isSecret ? 'Rare Secret' : rarities[(i - 1) % rarities.length];
    const price = isSecret ? 120.00 + (i * 12.5) : 1.50 + (i * 2.2);
    const numStr = String(i);
    
    cards.push({
      id: `${setId}-${numStr}`,
      name: name,
      imageUrl: `https://images.pokemontcg.io/${setId}/${numStr}.png`,
      imageUrlHiRes: `https://images.pokemontcg.io/${setId}/${numStr}_hires.png`,
      number: numStr,
      rarity: rarity,
      isSecret: isSecret,
      marketPrice: parseFloat(price.toFixed(2)),
      set: {
        id: setId,
        name: setName,
        printedTotal: total
      }
    });
  }
  return cards;
};

const API_KEY = 'd5abbd0d-c83c-403b-9051-23197bdf8837';

// FETCH ENGINE WITH MULTIPLE RETRIES AND EXTENDED TIMEOUT
const fetchWithRetry = async (url: string, options: RequestInit = {}, timeout = 25000, retries = 2): Promise<Response> => {
  for (let i = 0; i <= retries; i++) {
    const controller = new AbortController();
    const id = setTimeout(() => controller.abort(), timeout);
    try {
      const response = await fetch(url, {
        ...options,
        signal: controller.signal,
        headers: {
          'Accept': 'application/json',
          'Content-Type': 'application/json',
          'X-Api-Key': API_KEY,
          ...options.headers,
        }
      });
      clearTimeout(id);
      if (!response.ok) {
        throw new Error(`API Error: ${response.status} ${response.statusText}`);
      }
      return response;
    } catch (error: any) {
      clearTimeout(id);
      if (i === retries) {
        throw error;
      }
      console.warn(`Fetch failed (attempt ${i + 1}/${retries + 1}). Retrying in 1s...`, error);
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
  }
  throw new Error("Fetch failed after maximum retries");
};

// MAP SETS SERIES (ERA) FOR SPECIAL CASES LIKE MCDONALD'S AND NP PROMOS
export const mapSetSeries = (set: { id: string; name: string; series: string; releaseDate: string }): string => {
  let seriesName = set.series || '';
  const setId = (set.id || '').toLowerCase();
  const setName = (set.name || '').toLowerCase();
  const releaseDate = set.releaseDate || '';

  // 1. Coloque a era NP que contem a coleção nintendo black star promos 2003/10/01 dentro da era EX
  if (seriesName === 'NP' || setId === 'np' || setName.includes('nintendo black star promos') || setName.includes('nintendo promos')) {
    return 'EX';
  }

  // 2. Além disso, corrija as coleções do mcdonald's e coloque-as em suas devidas eras de acordo com o range de ano.
  if (setId.startsWith('mcd') || setName.includes('mcdonald')) {
    if (releaseDate) {
      const year = parseInt(releaseDate.split('-')[0]);
      if (!isNaN(year)) {
        if (year <= 2002) return 'Base';
        if (year >= 2003 && year <= 2006) return 'EX';
        if (year >= 2007 && year <= 2009) return 'Diamond & Pearl';
        if (year === 2010) return 'HeartGold & SoulSilver';
        if (year >= 2011 && year <= 2013) return 'Black & White';
        if (year >= 2014 && year <= 2016) return 'XY';
        if (year >= 2017 && year <= 2019) return 'Sun & Moon';
        if (year >= 2020 && year <= 2022) return 'Sword & Shield';
        if (year >= 2023) return 'Scarlet & Violet';
      }
    }
  }

  return seriesName;
};

// FETCH SETS WITH CACHING AND ROBUST FALLBACKS
export const fetchSets = async () => {
  const CACHE_KEY = 'poketracker_cache_sets';
  
  // Try to load cached sets from localStorage first to serve immediately
  let cachedData = null;
  try {
    const item = localStorage.getItem(CACHE_KEY);
    if (item) {
      cachedData = JSON.parse(item);
    }
  } catch (e) {
    console.warn("Could not read sets cache:", e);
  }

  // 1. Se possuímos cache local, retornamos ele instantaneamente (SWR)
  if (cachedData && Array.isArray(cachedData) && cachedData.length > 0) {
    const mappedCached = cachedData.map((set: any) => ({
      ...set,
      series: mapSetSeries(set)
    }));

    // Sincroniza em background em silêncio de forma não-bloqueante
    fetch(`${API_BASE}/sets?orderBy=-releaseDate`, {
      headers: {
        'Accept': 'application/json',
        'X-Api-Key': API_KEY
      }
    })
      .then(res => {
        if (!res.ok) throw new Error("API status not ok");
        return res.json();
      })
      .then(data => {
        if (data && data.data) {
          const mappedSets = data.data.map((set: any) => {
            const mappedSet = {
              id: set.id,
              name: set.name,
              series: set.series,
              printedTotal: set.printedTotal,
              total: set.total,
              logoUrl: set.images?.logo || '',
              symbolUrl: set.images?.symbol || '',
              releaseDate: set.releaseDate,
              updatedAt: set.updatedAt
            };
            mappedSet.series = mapSetSeries(mappedSet);
            return mappedSet;
          });
          localStorage.setItem(CACHE_KEY, JSON.stringify(mappedSets));
          console.log("Sets cache updated in background.");
        }
      })
      .catch(err => {
        console.warn("Background sets sync skipped/failed:", err.message);
      });

    console.info("Using cached sets list immediately (SWR active)");
    return mappedCached;
  }

  // 2. Se não há cache, fazemos a requisição de forma bloqueante (com timeout mais ágil de 6s)
  try {
    const response = await fetchWithRetry(`${API_BASE}/sets?orderBy=-releaseDate`, {}, 6000, 1);
    const data = await response.json();
    if (!data || !data.data) throw new Error("Invalid data format received from API");
    
    const mappedSets = data.data.map((set: any) => {
      const mappedSet = {
        id: set.id,
        name: set.name,
        series: set.series,
        printedTotal: set.printedTotal,
        total: set.total,
        logoUrl: set.images?.logo || '',
        symbolUrl: set.images?.symbol || '',
        releaseDate: set.releaseDate,
        updatedAt: set.updatedAt
      };
      mappedSet.series = mapSetSeries(mappedSet);
      return mappedSet;
    });

    // Cacheia com sucesso os sets obtidos
    try {
      localStorage.setItem(CACHE_KEY, JSON.stringify(mappedSets));
    } catch (e) {
      console.warn("Could not write sets cache:", e);
    }

    return mappedSets;
  } catch (error) {
    console.error("Error fetching sets:", error);
    
    // Retorna do offline fallback
    console.info("Using offline fallback sets list");
    const mappedFallback = FALLBACK_SETS.map((set: any) => {
      const mappedSet = { ...set };
      mappedSet.series = mapSetSeries(mappedSet);
      return mappedSet;
    });
    return mappedFallback;
  }
};

// FETCH CARDS WITH CACHING AND ROBUST FALLBACKS
export const fetchCardsBySet = async (setId: string, skipBackgroundSync = false) => {
  const CACHE_KEY = `poketracker_cache_cards_${setId}`;

  // Try to load cached cards from localStorage first
  let cachedData = null;
  try {
    const item = localStorage.getItem(CACHE_KEY);
    if (item) {
      cachedData = JSON.parse(item);
    }
  } catch (e) {
    console.warn("Could not read cards cache:", e);
  }

  // 1. Se temos cache local, retornamos ele imediatamente
  if (cachedData && Array.isArray(cachedData) && cachedData.length > 0) {
    if (!skipBackgroundSync) {
      // Sincroniza em background em silêncio de forma não-bloqueante
      fetch(`${API_BASE}/cards?q=set.id:${setId}&orderBy=number`, {
        headers: {
          'Accept': 'application/json',
          'X-Api-Key': API_KEY
        }
      })
        .then(res => {
          if (!res.ok) throw new Error("API status not ok");
          return res.json();
        })
        .then(data => {
          if (data && data.data) {
            const mappedCards = data.data.map((card: any) => ({
              id: card.id,
              name: card.name,
              imageUrl: card.images?.small || '',
              imageUrlHiRes: card.images?.large || '',
              number: card.number,
              rarity: card.rarity || 'Common',
              isSecret: parseInt(card.number) > (card.set.printedTotal || 0),
              marketPrice: card.tcgplayer?.prices?.holofoil?.market || card.tcgplayer?.prices?.normal?.market || 0,
              set: {
                id: card.set.id,
                name: card.set.name,
                printedTotal: card.set.printedTotal
              }
            }));
            localStorage.setItem(CACHE_KEY, JSON.stringify(mappedCards));
            console.log(`Cards cache for ${setId} updated in background.`);
          }
        })
        .catch(err => {
          console.warn(`Background cards sync for ${setId} skipped/failed:`, err.message);
        });
    }

    console.info(`Using cached cards list for set ${setId} immediately (SWR active)`);
    return cachedData;
  }

  // 2. Se não temos cache, fazemos o fetch bloqueante (com timeout mais ágil de 6s)
  try {
    const response = await fetchWithRetry(`${API_BASE}/cards?q=set.id:${setId}&orderBy=number`, {}, 6000, 1);
    const data = await response.json();
    if (!data || !data.data) throw new Error("Invalid data format received from API");

    const mappedCards = data.data.map((card: any) => ({
      id: card.id,
      name: card.name,
      imageUrl: card.images?.small || '',
      imageUrlHiRes: card.images?.large || '',
      number: card.number,
      rarity: card.rarity || 'Common',
      isSecret: parseInt(card.number) > (card.set.printedTotal || 0),
      marketPrice: card.tcgplayer?.prices?.holofoil?.market || card.tcgplayer?.prices?.normal?.market || 0,
      set: {
        id: card.set.id,
        name: card.set.name,
        printedTotal: card.set.printedTotal
      }
    }));

    // Cacheia com sucesso as cartas obtidas
    try {
      localStorage.setItem(CACHE_KEY, JSON.stringify(mappedCards));
    } catch (e) {
      console.warn("Could not write cards cache:", e);
    }

    return mappedCards;
  } catch (error: any) {
    const isAbort = error?.name === 'AbortError' || error?.message?.includes('abort') || error?.message?.includes('aborted');
    if (isAbort) {
      console.warn(`Fetch for set ${setId} was aborted. Using fallback or mock cards.`);
    } else {
      console.warn(`Error fetching cards for set ${setId}: ${error?.message || error}. Using fallback or mock cards.`);
    }

    // Se falhar e houver algum fallback configurado
    if (FALLBACK_CARDS[setId]) {
      console.info(`Using configured fallback cards for set ${setId}`);
      return FALLBACK_CARDS[setId];
    }

    // Tenta adivinhar o nome do set baseado nos fallbacks ou caches
    let setName = 'Set';
    try {
      const setsCacheStr = localStorage.getItem('poketracker_cache_sets');
      const sets = setsCacheStr ? JSON.parse(setsCacheStr) : FALLBACK_SETS;
      const matchingSet = sets.find((s: any) => s.id === setId);
      if (matchingSet) setName = matchingSet.name;
    } catch (e) {}

    console.info(`Generating mock cards for set ${setId}`);
    return generateMockCards(setId, setName);
  }
};
