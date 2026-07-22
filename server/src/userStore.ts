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

  const friendIds = (friendsRes.data || []).map((r) => r.friend_user_id);
  let friendProfiles: Record<string, { username: string; avatar_url: string }> = {};
  if (friendIds.length > 0) {
    const { data: profRows, error: profErr } = await supabase
      .from('profiles')
      .select('id, username, avatar_url')
      .in('id', friendIds);
    if (profErr) throw profErr;
    friendProfiles = Object.fromEntries((profRows || []).map((p) => [p.id, { username: p.username, avatar_url: p.avatar_url }]));
  }
  const friends: FriendEntry[] = (friendsRes.data || []).map((r) => ({
    userId: r.friend_user_id,
    username: friendProfiles[r.friend_user_id]?.username || '???',
    avatarUrl: friendProfiles[r.friend_user_id]?.avatar_url || '',
    addedAt: r.added_at,
  }));

  const folderIds = (foldersRes.data || []).map((f) => f.id);
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
  const folders = (foldersRes.data || []).map((f) => ({
    id: f.id,
    name: f.name,
    visibleToFriends: f.visible_to_friends,
    cardIds: folderCardsByFolder[f.id] || [],
    variationSelections: f.variation_selections || {},
  }));

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

export async function replaceUserData(userId: string, data: UserDataInput): Promise<void> {
  const { error: profileErr } = await supabase
    .from('profiles')
    .update({ username: data.username ?? '', avatar_url: data.avatarUrl ?? '' })
    .eq('id', userId);
  if (profileErr) throw profileErr;

  // upsert + apagar só as linhas removidas (calculado por diff, nunca "delete tudo depois
  // reinsere"): duas chamadas de PUT /api/users/me para o mesmo usuário podem se sobrepor no
  // tempo (ex: o efeito de sincronização da "Pasta de Repetidas" disparando junto de outra
  // alteração do usuário) - com delete-then-insert, a segunda chamada tenta inserir uma linha
  // que a primeira já reinseriu, violando a chave primária (23505). upsert é idempotente mesmo
  // com chamadas concorrentes. O diff é feito buscando os ids atuais e comparando em memória
  // (em vez de um NOT IN com a lista inteira de cartas mantidas) porque coleções reais chegam a
  // ter 700+ cartas - um filtro NOT IN desse tamanho vira uma query string enorme.
  const cardRows = Object.entries(data.ownedCards || {}).map(([cardId, card]) => ({
    user_id: userId,
    card_id: cardId,
    is_owned: !!card.isOwned,
    is_for_trade: !!card.isForTrade,
    variations: card.variations || {},
  }));
  if (cardRows.length > 0) {
    const { error } = await supabase.from('user_cards').upsert(cardRows, { onConflict: 'user_id,card_id' });
    if (error) throw error;
  }
  {
    const keepIds = new Set(Object.keys(data.ownedCards || {}));
    const { data: existing, error: existingErr } = await supabase.from('user_cards').select('card_id').eq('user_id', userId);
    if (existingErr) throw existingErr;
    const staleIds = (existing || []).map((r) => r.card_id).filter((id) => !keepIds.has(id));
    if (staleIds.length > 0) {
      const { error } = await supabase.from('user_cards').delete().eq('user_id', userId).in('card_id', staleIds);
      if (error) throw error;
    }
  }

  const wishlistRows = (data.wishlist || []).map((cardId) => ({ user_id: userId, card_id: cardId }));
  if (wishlistRows.length > 0) {
    const { error } = await supabase.from('wishlist').upsert(wishlistRows, { onConflict: 'user_id,card_id' });
    if (error) throw error;
  }
  {
    const keepIds = new Set(data.wishlist || []);
    const { data: existing, error: existingErr } = await supabase.from('wishlist').select('card_id').eq('user_id', userId);
    if (existingErr) throw existingErr;
    const staleIds = (existing || []).map((r) => r.card_id).filter((id) => !keepIds.has(id));
    if (staleIds.length > 0) {
      const { error } = await supabase.from('wishlist').delete().eq('user_id', userId).in('card_id', staleIds);
      if (error) throw error;
    }
  }

  const folders = data.folders || [];
  if (folders.length > 0) {
    const { error: foldersUpsertErr } = await supabase
      .from('trade_folders')
      .upsert(
        folders.map((f) => ({ id: f.id, user_id: userId, name: f.name, visible_to_friends: !!f.visibleToFriends, variation_selections: f.variationSelections || {} })),
        { onConflict: 'id' }
      );
    if (foldersUpsertErr) throw foldersUpsertErr;
  }
  {
    const keepFolderIds = new Set(folders.map((f) => f.id));
    const { data: existing, error: existingErr } = await supabase.from('trade_folders').select('id').eq('user_id', userId);
    if (existingErr) throw existingErr;
    const staleFolderIds = (existing || []).map((r) => r.id).filter((id) => !keepFolderIds.has(id));
    // trade_folder_cards é removido em cascata quando a linha de trade_folders correspondente é apagada
    if (staleFolderIds.length > 0) {
      const { error } = await supabase.from('trade_folders').delete().eq('user_id', userId).in('id', staleFolderIds);
      if (error) throw error;
    }
  }

  for (const folder of folders) {
    const keepCardIds = new Set(folder.cardIds || []);
    const { data: existing, error: existingErr } = await supabase.from('trade_folder_cards').select('card_id').eq('folder_id', folder.id);
    if (existingErr) throw existingErr;
    const staleCardIds = (existing || []).map((r) => r.card_id).filter((id) => !keepCardIds.has(id));
    if (staleCardIds.length > 0) {
      const { error } = await supabase.from('trade_folder_cards').delete().eq('folder_id', folder.id).in('card_id', staleCardIds);
      if (error) throw error;
    }
    const folderCardRows = (folder.cardIds || []).map((cardId) => ({ folder_id: folder.id, card_id: cardId }));
    if (folderCardRows.length > 0) {
      const { error } = await supabase.from('trade_folder_cards').upsert(folderCardRows, { onConflict: 'folder_id,card_id' });
      if (error) throw error;
    }
  }
}
