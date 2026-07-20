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
  quantity: number;
}

export interface FullUser {
  id: string;
  username: string;
  email: string;
  avatarUrl: string;
  friendCode: string;
  ownedCards: Record<string, { cardId: string; isOwned: boolean; isForTrade: boolean; variations: Record<string, any> }>;
  friends: FriendEntry[];
  folders: { id: string; name: string; cardIds: string[]; visibleToFriends: boolean; variationSelections: Record<string, TradeFolderVariationSelection[]> }[];
  wishlist: string[];
}

export async function assembleFullUser(userId: string, email: string): Promise<FullUser | null> {
  const { data: profile, error: profileErr } = await supabase
    .from('profiles')
    .select('id, username, avatar_url, friend_code')
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

  const { error: deleteCardsErr } = await supabase.from('user_cards').delete().eq('user_id', userId);
  if (deleteCardsErr) throw deleteCardsErr;
  const cardRows = Object.entries(data.ownedCards || {}).map(([cardId, card]) => ({
    user_id: userId,
    card_id: cardId,
    is_owned: !!card.isOwned,
    is_for_trade: !!card.isForTrade,
    variations: card.variations || {},
  }));
  if (cardRows.length > 0) {
    const { error } = await supabase.from('user_cards').insert(cardRows);
    if (error) throw error;
  }

  const { error: deleteWishlistErr } = await supabase.from('wishlist').delete().eq('user_id', userId);
  if (deleteWishlistErr) throw deleteWishlistErr;
  const wishlistRows = (data.wishlist || []).map((cardId) => ({ user_id: userId, card_id: cardId }));
  if (wishlistRows.length > 0) {
    const { error } = await supabase.from('wishlist').insert(wishlistRows);
    if (error) throw error;
  }

  // trade_folder_cards é removido em cascata quando as linhas de trade_folders são apagadas
  const { error: deleteFoldersErr } = await supabase.from('trade_folders').delete().eq('user_id', userId);
  if (deleteFoldersErr) throw deleteFoldersErr;
  const folders = data.folders || [];
  if (folders.length > 0) {
    const { error: foldersInsertErr } = await supabase
      .from('trade_folders')
      .insert(folders.map((f) => ({ id: f.id, user_id: userId, name: f.name, visible_to_friends: !!f.visibleToFriends, variation_selections: f.variationSelections || {} })));
    if (foldersInsertErr) throw foldersInsertErr;

    const folderCardRows = folders.flatMap((f) => (f.cardIds || []).map((cardId) => ({ folder_id: f.id, card_id: cardId })));
    if (folderCardRows.length > 0) {
      const { error: fcErr } = await supabase.from('trade_folder_cards').insert(folderCardRows);
      if (fcErr) throw fcErr;
    }
  }
}
