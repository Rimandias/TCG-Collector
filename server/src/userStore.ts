import { supabase } from './supabase.js';

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

  const [cardsRes, friendsRes, foldersRes, wishlistRes] = await Promise.all([
    supabase.from('user_cards').select('card_id, is_owned, is_for_trade, variations').eq('user_id', userId),
    supabase.from('friends').select('friend_user_id, added_at').eq('user_id', userId).order('added_at', { ascending: true }),
    supabase.from('trade_folders').select('id, name, visible_to_friends, variation_selections').eq('user_id', userId),
    supabase.from('wishlist').select('card_id').eq('user_id', userId),
  ]);
  if (cardsRes.error) throw cardsRes.error;
  if (friendsRes.error) throw friendsRes.error;
  if (foldersRes.error) throw foldersRes.error;
  if (wishlistRes.error) throw wishlistRes.error;

  const ownedCards: FullUser['ownedCards'] = {};
  for (const row of cardsRes.data || []) {
    ownedCards[row.card_id] = {
      cardId: row.card_id,
      isOwned: row.is_owned,
      isForTrade: row.is_for_trade,
      variations: row.variations || {},
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
    supabase
      .from(table)
      .select(keyColumn)
      .eq(ownerColumn, ownerValue)
      .then((r) => {
        if (r.error) throw r.error;
        return (r.data || []) as Record<string, any>[];
      }),
  ]);

  const staleKeys = (existing || []).map((r) => r[keyColumn]).filter((k) => !keepKeys.has(k));
  if (staleKeys.length > 0) {
    const { error } = await supabase.from(table).delete().eq(ownerColumn, ownerValue).in(keyColumn, staleKeys);
    if (error) throw error;
  }
}

export async function replaceUserData(userId: string, data: UserDataInput): Promise<{ friendCode: string; isPremium: boolean }> {
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
      variations: card.variations || {},
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

// Monta a resposta de PUT /api/users/me a partir do que o cliente acabou de mandar (já
// validado e gravado por replaceUserData) em vez de reler tudo do banco de novo - cartas/
// pastas/wishlist já SÃO exatamente o que foi salvo, então reconsultar user_cards/
// trade_folders/trade_folder_cards (potencialmente centenas de linhas) seria trabalho
// redundante. Só busca de fato o que esse endpoint não gerencia (amigos), que é sempre uma
// lista pequena.
export async function buildUserResponseFromInput(
  userId: string,
  email: string,
  friendCode: string,
  isPremium: boolean,
  data: UserDataInput
): Promise<FullUser> {
  const { data: friendRows, error: friendsErr } = await supabase
    .from('friends')
    .select('friend_user_id, added_at')
    .eq('user_id', userId)
    .order('added_at', { ascending: true });
  if (friendsErr) throw friendsErr;
  const friends = await resolveFriends(userId, friendRows || []);

  const ownedCards: FullUser['ownedCards'] = {};
  for (const [cardId, card] of Object.entries(data.ownedCards || {})) {
    ownedCards[cardId] = {
      cardId,
      isOwned: !!card.isOwned,
      isForTrade: !!card.isForTrade,
      variations: card.variations || {},
    };
  }

  const folders = (data.folders || []).map((f) => ({
    id: f.id,
    name: f.name,
    cardIds: f.cardIds || [],
    visibleToFriends: !!f.visibleToFriends,
    variationSelections: f.variationSelections || {},
  }));

  return {
    id: userId,
    username: data.username ?? '',
    email,
    avatarUrl: data.avatarUrl ?? '',
    friendCode,
    isPremium,
    ownedCards,
    friends,
    folders,
    wishlist: data.wishlist || [],
  };
}
