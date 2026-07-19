// A geração do código de amigo agora acontece no banco (função generate_friend_code()
// chamada pelo trigger on_auth_user_created no signup). Este arquivo só normaliza a
// entrada do usuário ao adicionar um amigo por código.
export function normalizeFriendCode(input: string): string {
  return input.toUpperCase().replace(/[^A-Z0-9]/g, '');
}
