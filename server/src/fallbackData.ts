// Dados de contingência (offline-first) usados quando a Pokemon TCG API está indisponível.
// Migrados do antigo api.ts do frontend para manter o cliente sem lógica de acesso externo.

export const FALLBACK_SETS = [
  {
    id: 'sv1', name: 'Scarlet & Violet', series: 'Scarlet & Violet', printedTotal: 198, total: 258,
    logoUrl: 'https://images.pokemontcg.io/sv1/logo.png', symbolUrl: 'https://images.pokemontcg.io/sv1/symbol.png',
    releaseDate: '2023-03-31', updatedAt: '2023-03-31',
  },
  {
    id: 'sv3pt5', name: '151', series: 'Scarlet & Violet', printedTotal: 165, total: 207,
    logoUrl: 'https://images.pokemontcg.io/sv3pt5/logo.png', symbolUrl: 'https://images.pokemontcg.io/sv3pt5/symbol.png',
    releaseDate: '2023-09-22', updatedAt: '2023-09-22',
  },
  {
    id: 'swsh12', name: 'Silver Tempest', series: 'Sword & Shield', printedTotal: 195, total: 245,
    logoUrl: 'https://images.pokemontcg.io/swsh12/logo.png', symbolUrl: 'https://images.pokemontcg.io/swsh12/symbol.png',
    releaseDate: '2022-11-11', updatedAt: '2022-11-11',
  },
  {
    id: 'swsh11', name: 'Lost Origin', series: 'Sword & Shield', printedTotal: 196, total: 247,
    logoUrl: 'https://images.pokemontcg.io/swsh11/logo.png', symbolUrl: 'https://images.pokemontcg.io/swsh11/symbol.png',
    releaseDate: '2022-09-09', updatedAt: '2022-09-09',
  },
  {
    id: 'swsh9', name: 'Brilliant Stars', series: 'Sword & Shield', printedTotal: 172, total: 186,
    logoUrl: 'https://images.pokemontcg.io/swsh9/logo.png', symbolUrl: 'https://images.pokemontcg.io/swsh9/symbol.png',
    releaseDate: '2022-02-25', updatedAt: '2022-02-25',
  },
  {
    id: 'base1', name: 'Base Set', series: 'Base', printedTotal: 102, total: 102,
    logoUrl: 'https://images.pokemontcg.io/base1/logo.png', symbolUrl: 'https://images.pokemontcg.io/base1/symbol.png',
    releaseDate: '1999-01-09', updatedAt: '1999-01-09',
  },
  {
    id: 'base2', name: 'Jungle', series: 'Base', printedTotal: 64, total: 64,
    logoUrl: 'https://images.pokemontcg.io/base2/logo.png', symbolUrl: 'https://images.pokemontcg.io/base2/symbol.png',
    releaseDate: '1999-06-16', updatedAt: '1999-06-16',
  },
  {
    id: 'base3', name: 'Fossil', series: 'Base', printedTotal: 62, total: 62,
    logoUrl: 'https://images.pokemontcg.io/base3/logo.png', symbolUrl: 'https://images.pokemontcg.io/base3/symbol.png',
    releaseDate: '1999-10-10', updatedAt: '1999-10-10',
  },
];

export const FALLBACK_CARDS: Record<string, any[]> = {
  base1: [
    { id: 'base1-4', name: 'Charizard', imageUrl: 'https://images.pokemontcg.io/base1/4.png', imageUrlHiRes: 'https://images.pokemontcg.io/base1/4_hires.png', number: '4', rarity: 'Rare Holo', isSecret: false, marketPrice: 350.0, set: { id: 'base1', name: 'Base Set', printedTotal: 102 } },
    { id: 'base1-2', name: 'Blastoise', imageUrl: 'https://images.pokemontcg.io/base1/2.png', imageUrlHiRes: 'https://images.pokemontcg.io/base1/2_hires.png', number: '2', rarity: 'Rare Holo', isSecret: false, marketPrice: 120.0, set: { id: 'base1', name: 'Base Set', printedTotal: 102 } },
    { id: 'base1-15', name: 'Venusaur', imageUrl: 'https://images.pokemontcg.io/base1/15.png', imageUrlHiRes: 'https://images.pokemontcg.io/base1/15_hires.png', number: '15', rarity: 'Rare Holo', isSecret: false, marketPrice: 85.0, set: { id: 'base1', name: 'Base Set', printedTotal: 102 } },
    { id: 'base1-58', name: 'Pikachu', imageUrl: 'https://images.pokemontcg.io/base1/58.png', imageUrlHiRes: 'https://images.pokemontcg.io/base1/58_hires.png', number: '58', rarity: 'Common', isSecret: false, marketPrice: 2.5, set: { id: 'base1', name: 'Base Set', printedTotal: 102 } },
    { id: 'base1-10', name: 'Mewtwo', imageUrl: 'https://images.pokemontcg.io/base1/10.png', imageUrlHiRes: 'https://images.pokemontcg.io/base1/10_hires.png', number: '10', rarity: 'Rare Holo', isSecret: false, marketPrice: 35.0, set: { id: 'base1', name: 'Base Set', printedTotal: 102 } },
    { id: 'base1-1', name: 'Alakazam', imageUrl: 'https://images.pokemontcg.io/base1/1.png', imageUrlHiRes: 'https://images.pokemontcg.io/base1/1_hires.png', number: '1', rarity: 'Rare Holo', isSecret: false, marketPrice: 42.0, set: { id: 'base1', name: 'Base Set', printedTotal: 102 } },
    { id: 'base1-6', name: 'Gyarados', imageUrl: 'https://images.pokemontcg.io/base1/6.png', imageUrlHiRes: 'https://images.pokemontcg.io/base1/6_hires.png', number: '6', rarity: 'Rare Holo', isSecret: false, marketPrice: 28.0, set: { id: 'base1', name: 'Base Set', printedTotal: 102 } },
  ],
  sv3pt5: [
    { id: 'sv3pt5-1', name: 'Bulbasaur', imageUrl: 'https://images.pokemontcg.io/sv3pt5/1.png', imageUrlHiRes: 'https://images.pokemontcg.io/sv3pt5/1_hires.png', number: '1', rarity: 'Common', isSecret: false, marketPrice: 0.5, set: { id: 'sv3pt5', name: '151', printedTotal: 165 } },
    { id: 'sv3pt5-4', name: 'Charmander', imageUrl: 'https://images.pokemontcg.io/sv3pt5/4.png', imageUrlHiRes: 'https://images.pokemontcg.io/sv3pt5/4_hires.png', number: '4', rarity: 'Common', isSecret: false, marketPrice: 1.2, set: { id: 'sv3pt5', name: '151', printedTotal: 165 } },
    { id: 'sv3pt5-7', name: 'Squirtle', imageUrl: 'https://images.pokemontcg.io/sv3pt5/7.png', imageUrlHiRes: 'https://images.pokemontcg.io/sv3pt5/7_hires.png', number: '7', rarity: 'Common', isSecret: false, marketPrice: 0.8, set: { id: 'sv3pt5', name: '151', printedTotal: 165 } },
    { id: 'sv3pt5-25', name: 'Pikachu', imageUrl: 'https://images.pokemontcg.io/sv3pt5/25.png', imageUrlHiRes: 'https://images.pokemontcg.io/sv3pt5/25_hires.png', number: '25', rarity: 'Common', isSecret: false, marketPrice: 1.5, set: { id: 'sv3pt5', name: '151', printedTotal: 165 } },
    { id: 'sv3pt5-199', name: 'Charizard ex', imageUrl: 'https://images.pokemontcg.io/sv3pt5/199.png', imageUrlHiRes: 'https://images.pokemontcg.io/sv3pt5/199_hires.png', number: '199', rarity: 'Rare Special Illustration', isSecret: true, marketPrice: 120.0, set: { id: 'sv3pt5', name: '151', printedTotal: 165 } },
    { id: 'sv3pt5-205', name: 'Mew ex', imageUrl: 'https://images.pokemontcg.io/sv3pt5/205.png', imageUrlHiRes: 'https://images.pokemontcg.io/sv3pt5/205_hires.png', number: '205', rarity: 'Rare Hyper', isSecret: true, marketPrice: 85.0, set: { id: 'sv3pt5', name: '151', printedTotal: 165 } },
  ],
};

export function generateMockCards(setId: string, setName: string, total = 9) {
  const pokemonNames = ['Charizard', 'Pikachu', 'Mewtwo', 'Blastoise', 'Venusaur', 'Alakazam', 'Lugia', 'Gengar', 'Rayquaza', 'Eevee', 'Mew', 'Lucario', 'Gardevoir', 'Gyarados'];
  const rarities = ['Common', 'Uncommon', 'Rare Holo', 'Rare Ultra', 'Rare Secret'];

  const cards = [];
  for (let i = 1; i <= total; i++) {
    const name = pokemonNames[(i - 1) % pokemonNames.length];
    const isSecret = i > Math.floor(total * 0.85);
    const rarity = isSecret ? 'Rare Secret' : rarities[(i - 1) % rarities.length];
    const price = isSecret ? 120.0 + i * 12.5 : 1.5 + i * 2.2;
    const numStr = String(i);

    cards.push({
      id: `${setId}-${numStr}`,
      name,
      imageUrl: `https://images.pokemontcg.io/${setId}/${numStr}.png`,
      imageUrlHiRes: `https://images.pokemontcg.io/${setId}/${numStr}_hires.png`,
      number: numStr,
      rarity,
      isSecret,
      marketPrice: parseFloat(price.toFixed(2)),
      set: { id: setId, name: setName, printedTotal: total },
    });
  }
  return cards;
}

export function mapSetSeries(set: { id: string; name: string; series: string; releaseDate: string }): string {
  let seriesName = set.series || '';
  const setId = (set.id || '').toLowerCase();
  const setName = (set.name || '').toLowerCase();
  const releaseDate = set.releaseDate || '';

  if (seriesName === 'NP' || setId === 'np' || setName.includes('nintendo black star promos') || setName.includes('nintendo promos')) {
    return 'EX';
  }

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
}
