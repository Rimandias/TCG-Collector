import { db } from './db.js';

export interface FullUser {
  id: string;
  username: string;
  email: string;
  avatarUrl: string;
  ownedCards: Record<string, { cardId: string; isOwned: boolean; isForTrade: boolean; variations: Record<string, any> }>;
  friends: string[];
  folders: { id: string; name: string; cardIds: string[] }[];
  wishlist: string[];
}

const getUserRow = db.prepare(`SELECT id, username, email, avatar_url FROM users WHERE id = ?`);
const getUserCards = db.prepare(`SELECT card_id, is_owned, is_for_trade, variations FROM user_cards WHERE user_id = ?`);
const getFriends = db.prepare(`SELECT friend_name FROM friends WHERE user_id = ?`);
const getFolders = db.prepare(`SELECT id, name FROM trade_folders WHERE user_id = ?`);
const getFolderCards = db.prepare(`SELECT card_id FROM trade_folder_cards WHERE folder_id = ?`);
const getWishlist = db.prepare(`SELECT card_id FROM wishlist WHERE user_id = ?`);

export function assembleFullUser(userId: string): FullUser | null {
  const userRow = getUserRow.get(userId) as { id: string; username: string; email: string; avatar_url: string } | undefined;
  if (!userRow) return null;

  const ownedCards: FullUser['ownedCards'] = {};
  for (const row of getUserCards.all(userId) as any[]) {
    ownedCards[row.card_id] = {
      cardId: row.card_id,
      isOwned: !!row.is_owned,
      isForTrade: !!row.is_for_trade,
      variations: JSON.parse(row.variations || '{}'),
    };
  }

  const friends = (getFriends.all(userId) as any[]).map((r) => r.friend_name);

  const folders = (getFolders.all(userId) as any[]).map((f) => ({
    id: f.id as string,
    name: f.name as string,
    cardIds: (getFolderCards.all(f.id) as any[]).map((c) => c.card_id as string),
  }));

  const wishlist = (getWishlist.all(userId) as any[]).map((r) => r.card_id);

  return {
    id: userRow.id,
    username: userRow.username,
    email: userRow.email,
    avatarUrl: userRow.avatar_url,
    ownedCards,
    friends,
    folders,
    wishlist,
  };
}

export interface UserDataInput {
  username?: string;
  avatarUrl?: string;
  ownedCards?: Record<string, { isOwned?: boolean; isForTrade?: boolean; variations?: Record<string, any> }>;
  friends?: string[];
  folders?: { id: string; name: string; cardIds: string[] }[];
  wishlist?: string[];
}

const updateProfile = db.prepare(`UPDATE users SET username = ?, avatar_url = ? WHERE id = ?`);
const deleteUserCards = db.prepare(`DELETE FROM user_cards WHERE user_id = ?`);
const insertUserCard = db.prepare(`
  INSERT INTO user_cards (user_id, card_id, is_owned, is_for_trade, variations) VALUES (?, ?, ?, ?, ?)
`);
const deleteWishlist = db.prepare(`DELETE FROM wishlist WHERE user_id = ?`);
const insertWishlist = db.prepare(`INSERT INTO wishlist (user_id, card_id) VALUES (?, ?)`);
const deleteFriends = db.prepare(`DELETE FROM friends WHERE user_id = ?`);
const insertFriend = db.prepare(`INSERT OR IGNORE INTO friends (user_id, friend_name) VALUES (?, ?)`);
const deleteFolders = db.prepare(`DELETE FROM trade_folders WHERE user_id = ?`);
const insertFolder = db.prepare(`INSERT INTO trade_folders (id, user_id, name) VALUES (?, ?, ?)`);
const insertFolderCard = db.prepare(`INSERT OR IGNORE INTO trade_folder_cards (folder_id, card_id) VALUES (?, ?)`);

export const replaceUserData = db.transaction((userId: string, data: UserDataInput) => {
  updateProfile.run(data.username ?? '', data.avatarUrl ?? '', userId);

  deleteUserCards.run(userId);
  for (const [cardId, card] of Object.entries(data.ownedCards || {})) {
    insertUserCard.run(
      userId,
      cardId,
      card.isOwned ? 1 : 0,
      card.isForTrade ? 1 : 0,
      JSON.stringify(card.variations || {})
    );
  }

  deleteWishlist.run(userId);
  for (const cardId of data.wishlist || []) {
    insertWishlist.run(userId, cardId);
  }

  deleteFriends.run(userId);
  for (const name of data.friends || []) {
    insertFriend.run(userId, name);
  }

  // trade_folder_cards cascade-deletes via FK when trade_folders rows are removed
  deleteFolders.run(userId);
  for (const folder of data.folders || []) {
    insertFolder.run(folder.id, userId, folder.name);
    for (const cardId of folder.cardIds || []) {
      insertFolderCard.run(folder.id, cardId);
    }
  }
});
