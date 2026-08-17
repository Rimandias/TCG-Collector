import { supabase } from './supabase.js';

// O PostgREST (API do Supabase) devolve no máximo 1000 linhas por requisição por padrão -
// sem paginação explícita, uma tabela com mais de 1000 linhas (ex: coleção grande de cartas,
// uma conta real chegou a ter 1001) tem o resto silenciosamente cortado (a resposta vem como
// 206 Partial Content, mas nada aqui checava isso). Isso já causou perda de dados real: a
// carta que ficava de fora da primeira página nunca entrava no estado local do app, então
// QUALQUER salvamento seguinte - mesmo de uma carta totalmente diferente - apagava ela do
// banco, por "não estar na lista enviada". Pagina explicitamente até esgotar as linhas.
const SUPABASE_PAGE_SIZE = 1000;

async function fetchAllRows<T>(fetchPage: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: any }>): Promise<T[]> {
  const rows: T[] = [];
  let from = 0;
  while (true) {
    const { data, error } = await fetchPage(from, from + SUPABASE_PAGE_SIZE - 1);
    if (error) throw error;
    rows.push(...(data || []));
    if (!data || data.length < SUPABASE_PAGE_SIZE) break;
    from += SUPABASE_PAGE_SIZE;
  }
  return rows;
}

// Serializa as escritas de um mesmo usuário: sem isso, duas chamadas de replaceUserData
// sobrepostas no tempo podem se intercalar dentro de syncKeyedTable de um jeito totalmente
// não-determinístico - a checagem "o que existe no banco que não veio nesse payload" de uma
// delas pode rodar bem no meio da outra ainda em andamento, dependendo só de timing de rede.
// Com a fila (processo roda com WEB_CONCURRENCY=1, uma única instância Node, então uma fila
// em memória por usuário já garante isso sem lock distribuído), a segunda escrita só começa
// depois que a primeira terminou de vez - o resultado passa a depender só da ORDEM de chegada,
// nunca de acidente de timing dentro do banco.
//
// Isso NÃO elimina sozinho o cenário de duas sessões genuinamente divergentes (ex: app aberto
// no celular e no navegador ao mesmo tempo, cada uma sem saber da edição feita na outra) - se
// a sessão B salva sem conhecer uma carta que A acabou de adicionar, B ainda vai apagar essa
// carta ao rodar depois de A, porque o payload de B nunca a incluiu. O que a fila garante é
// que uma edição sequencial da MESMA sessão (que sempre parte do estado local mais recente,
// logo um superconjunto do que já foi salvo) nunca perde dado - é o caso comum do app.
const userWriteLocks = new Map<string, Promise<void>>();

function withUserLock<T>(userId: string, fn: () => Promise<T>): Promise<T> {
  const previous = userWriteLocks.get(userId) || Promise.resolve();
  const run = previous.then(fn, fn);
  const queuePosition = run.then(() => undefined, () => undefined);
  userWriteLocks.set(userId, queuePosition);
  queuePosition.finally(() => {
    if (userWriteLocks.get(userId) === queuePosition) userWriteLocks.delete(userId);
  });
  return run;
}

// `variations` é conceitualmente um mapa esparso (só as combinações de variação/condição
// que o usuário realmente preencheu), mas o cliente sempre manda a matriz cheia expandida
// (6 tipos de variação x 5 condições = 30 entradas por carta, a maioria quantity:0/price:'').
// Guardar e reenviar isso denso desperdiça banda e espaço em disco proporcionalmente ao
// tamanho do catálogo, não da coleção real do usuário - medido em produção, uma carta comum
// com só 1 variação preenchida ocupava 1645 bytes armazenando as 30 entradas por extenso,
// contra ~150 bytes só com a que importa. getNormalizedVariations (frontend) já sabe expandir
// de volta um subconjunto esparso pros valores padrão, então remover as entradas vazias aqui
// não perde nenhuma informação.
function sparsifyVariations(variations: Record<string, any> | null | undefined): Record<string, any> {
  const result: Record<string, any> = {};
  for (const [variationType, conditions] of Object.entries(variations || {})) {
    const keptConditions: Record<string, any> = {};
    for (const [condition, details] of Object.entries(conditions as Record<string, any>)) {
      const d = (details || {}) as { quantity?: number; price?: string; languages?: Record<string, unknown> };
      const hasLanguages = !!d.languages && Object.keys(d.languages).length > 0;
      if ((d.quantity || 0) !== 0 || (d.price && d.price !== '') || hasLanguages) {
        keptConditions[condition] = d;
      }
    }
    if (Object.keys(keptConditions).length > 0) {
      result[variationType] = keptConditions;
    }
  }
  return result;
}

export interface FriendEntry {
  userId: string;
  username: string;
  avatarUrl: string;
  addedAt: string;
}

export interface TradeFolderVariationSelection {
  variation: string;
  condition: string;
  language?: string;
  quantity: number;
}

export interface FullUser {
  id: string;
  username: string;
  email: string;
  avatarUrl: string;
  friendCode: string;
  isPremium: boolean;
  ownedCards: Record<string, { cardId: string; isOwned: boolean; isForTrade: boolean; variations: Record<string, any> }>;
  friends: FriendEntry[];
  folders: { id: string; name: string; cardIds: string[]; visibleToFriends: boolean; variationSelections: Record<string, TradeFolderVariationSelection[]> }[];
  wishlist: string[];
}

export async function assembleFullUser(userId: string, email: string): Promise<FullUser | null> {
  const { data: profile, error: profileErr } = await supabase
    .from('profiles')
    .select('id, username, avatar_url, friend_code, is_premium')
    .eq('id', userId)
    .maybeSingle();
  if (profileErr) throw profileErr;
  if (!profile) return null;

  const [cardsRows, friendsRes, foldersRes, wishlistRes] = await Promise.all([
    fetchAllRows<{ card_id: string; is_owned: boolean; is_for_trade: boolean; variations: any }>((from, to) =>
      supabase.from('user_cards').select('card_id, is_owned, is_for_trade, variations').eq('user_id', userId).range(from, to)
    ),
    supabase.from('friends').select('friend_user_id, added_at').eq('user_id', userId).order('added_at', { ascending: true }),
    supabase.from('trade_folders').select('id, name, visible_to_friends, variation_selections').eq('user_id', userId),
    supabase.from('wishlist').select('card_id').eq('user_id', userId),
  ]);
  if (friendsRes.error) throw friendsRes.error;
  if (foldersRes.error) throw foldersRes.error;
  if (wishlistRes.error) throw wishlistRes.error;

  const ownedCards: FullUser['ownedCards'] = {};
  for (const row of cardsRows) {
    ownedCards[row.card_id] = {
      cardId: row.card_id,
      isOwned: row.is_owned,
      isForTrade: row.is_for_trade,
      // Linhas antigas (de antes desta otimização) ainda podem estar densas no banco -
      // sparsifica na leitura também, assim o ganho de banda vale imediatamente pra
      // qualquer linha, sem depender do usuário reeditar a carta pra "curar" o registro.
      variations: sparsifyVariations(row.variations),
    };
  }

  const [friends, folders] = await Promise.all([
    resolveFriends(userId, friendsRes.data || []),
    resolveFolders(foldersRes.data || []),
  ]);

  const wishlist = (wishlistRes.data || []).map((r) => r.card_id);

  return {
    id: profile.id,
    username: profile.username,
    email,
    avatarUrl: profile.avatar_url,
    friendCode: profile.friend_code,
    isPremium: profile.is_premium,
    ownedCards,
    friends,
    folders,
    wishlist,
  };
}

async function resolveFriends(userId: string, friendRows: { friend_user_id: string; added_at: string }[]): Promise<FriendEntry[]> {
  const friendIds = friendRows.map((r) => r.friend_user_id);
  let friendProfiles: Record<string, { username: string; avatar_url: string }> = {};
  if (friendIds.length > 0) {
    const { data: profRows, error: profErr } = await supabase
      .from('profiles')
      .select('id, username, avatar_url')
      .in('id', friendIds);
    if (profErr) throw profErr;
    friendProfiles = Object.fromEntries((profRows || []).map((p) => [p.id, { username: p.username, avatar_url: p.avatar_url }]));
  }
  return friendRows.map((r) => ({
    userId: r.friend_user_id,
    username: friendProfiles[r.friend_user_id]?.username || '???',
    avatarUrl: friendProfiles[r.friend_user_id]?.avatar_url || '',
    addedAt: r.added_at,
  }));
}

async function resolveFolders(folderRows: { id: string; name: string; visible_to_friends: boolean; variation_selections: any }[]): Promise<FullUser['folders']> {
  const folderIds = folderRows.map((f) => f.id);
  const folderCardsByFolder: Record<string, string[]> = {};
  if (folderIds.length > 0) {
    const { data: fcRows, error: fcErr } = await supabase
      .from('trade_folder_cards')
      .select('folder_id, card_id')
      .in('folder_id', folderIds);
    if (fcErr) throw fcErr;
    for (const row of fcRows || []) {
      (folderCardsByFolder[row.folder_id] ||= []).push(row.card_id);
    }
  }
  return folderRows.map((f) => ({
    id: f.id,
    name: f.name,
    visibleToFriends: f.visible_to_friends,
    cardIds: folderCardsByFolder[f.id] || [],
    variationSelections: f.variation_selections || {},
  }));
}

// Amigos são relações entre contas reais (validadas por código) e não podem ser
// substituídas livremente pelo cliente via este "replace" genérico — só são
// alterados pelas rotas dedicadas em routes/friends.ts.
export interface UserDataInput {
  username?: string;
  avatarUrl?: string;
  ownedCards?: Record<string, { isOwned?: boolean; isForTrade?: boolean; variations?: Record<string, any> }>;
  folders?: { id: string; name: string; cardIds: string[]; visibleToFriends?: boolean; variationSelections?: Record<string, TradeFolderVariationSelection[]> }[];
  wishlist?: string[];
}

// Sincroniza upsert + apagar só as linhas removidas (calculado por diff, nunca "delete tudo
// depois reinsere"): duas chamadas de PUT /api/users/me pro mesmo usuário podem se sobrepor
// no tempo (ex: o efeito de sincronização da "Pasta de Repetidas" disparando junto de outra
// alteração) - com delete-then-insert, a segunda chamada tenta inserir uma linha que a
// primeira já reinseriu, violando a chave primária (23505). upsert é idempotente mesmo com
// chamadas concorrentes.
//
// O upsert e a busca de ids atuais (pro diff) rodam em paralelo, não em sequência: o delete
// só remove ids que NÃO estão no conjunto a manter, e o upsert só mexe nos ids que ESTÃO -
// não há como os dois se atrapalharem não importa a ordem em que terminam. Isso elimina uma
// viagem inteira de rede por recurso, que antes eram sempre sequenciais.
async function syncKeyedTable(params: {
  table: string;
  ownerColumn: string;
  ownerValue: string;
  keyColumn: string;
  keepKeys: Set<string>;
  upsertRows: Record<string, any>[];
  onConflict: string;
}): Promise<void> {
  const { table, ownerColumn, ownerValue, keyColumn, keepKeys, upsertRows, onConflict } = params;

  const [, existing] = await Promise.all([
    upsertRows.length > 0
      ? supabase.from(table).upsert(upsertRows, { onConflict }).then((r) => {
          if (r.error) throw r.error;
        })
      : Promise.resolve(),
    fetchAllRows<Record<string, any>>((from, to) =>
      supabase.from(table).select(keyColumn).eq(ownerColumn, ownerValue).range(from, to)
    ),
  ]);

  const staleKeys = (existing || []).map((r) => r[keyColumn]).filter((k) => !keepKeys.has(k));
  if (staleKeys.length > 0) {
    const { error } = await supabase.from(table).delete().eq(ownerColumn, ownerValue).in(keyColumn, staleKeys);
    if (error) throw error;
  }
}

export function replaceUserData(userId: string, data: UserDataInput): Promise<{ friendCode: string; isPremium: boolean }> {
  return withUserLock(userId, () => replaceUserDataUnlocked(userId, data));
}

async function replaceUserDataUnlocked(userId: string, data: UserDataInput): Promise<{ friendCode: string; isPremium: boolean }> {
  const folders = data.folders || [];

  const profileUpdatePromise = supabase
    .from('profiles')
    .update({ username: data.username ?? '', avatar_url: data.avatarUrl ?? '' })
    .eq('id', userId)
    .select('friend_code, is_premium')
    .single();

  const cardsSyncPromise = syncKeyedTable({
    table: 'user_cards',
    ownerColumn: 'user_id',
    ownerValue: userId,
    keyColumn: 'card_id',
    keepKeys: new Set(Object.keys(data.ownedCards || {})),
    upsertRows: Object.entries(data.ownedCards || {}).map(([cardId, card]) => ({
      user_id: userId,
      card_id: cardId,
      is_owned: !!card.isOwned,
      is_for_trade: !!card.isForTrade,
      variations: sparsifyVariations(card.variations),
    })),
    onConflict: 'user_id,card_id',
  });

  const wishlistSyncPromise = syncKeyedTable({
    table: 'wishlist',
    ownerColumn: 'user_id',
    ownerValue: userId,
    keyColumn: 'card_id',
    keepKeys: new Set(data.wishlist || []),
    upsertRows: (data.wishlist || []).map((cardId) => ({ user_id: userId, card_id: cardId })),
    onConflict: 'user_id,card_id',
  });

  // trade_folders (a linha da pasta em si) e trade_folder_cards (as cartas dentro de cada
  // pasta) - as pastas entre si são independentes, então cada uma é sincronizada em paralelo
  // com as outras (antes era um for/await sequencial, uma pasta de cada vez).
  const foldersSyncPromise = (async () => {
    await syncKeyedTable({
      table: 'trade_folders',
      ownerColumn: 'user_id',
      ownerValue: userId,
      keyColumn: 'id',
      keepKeys: new Set(folders.map((f) => f.id)),
      upsertRows: folders.map((f) => ({
        id: f.id,
        user_id: userId,
        name: f.name,
        visible_to_friends: !!f.visibleToFriends,
        variation_selections: f.variationSelections || {},
      })),
      onConflict: 'id',
    });
    // trade_folder_cards é removido em cascata quando a linha de trade_folders correspondente
    // é apagada, então só falta sincronizar as cartas das pastas que continuam existindo.
    await Promise.all(
      folders.map((folder) =>
        syncKeyedTable({
          table: 'trade_folder_cards',
          ownerColumn: 'folder_id',
          ownerValue: folder.id,
          keyColumn: 'card_id',
          keepKeys: new Set(folder.cardIds || []),
          upsertRows: (folder.cardIds || []).map((cardId) => ({ folder_id: folder.id, card_id: cardId })),
          onConflict: 'folder_id,card_id',
        })
      )
    );
  })();

  const [profileResult] = await Promise.all([profileUpdatePromise, cardsSyncPromise, wishlistSyncPromise, foldersSyncPromise]);
  if (profileResult.error) throw profileResult.error;
  return { friendCode: profileResult.data.friend_code, isPremium: profileResult.data.is_premium };
}
