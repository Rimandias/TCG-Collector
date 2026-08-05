# HANDOFF — PokéTracker (TCG-Collector)

Documento de retomada de contexto. Objetivo: permitir iniciar uma conversa nova gastando poucos tokens, sem precisar reler o histórico completo. `CLAUDE.md` (raiz do repo) já cobre arquitetura/comandos/ambiente em detalhe e é carregado automaticamente em toda sessão — este arquivo complementa com o que `CLAUDE.md` não guarda: histórico de decisões, bugs já corrigidos (para não reabrir os mesmos) e pendências em aberto.

**Diretriz permanente do dono do app**: todas as respostas devem ser em **português**. Isso não está no `CLAUDE.md`, foi pedido em conversa — reafirme isso numa sessão nova se possível.

## O que é o app

PokéTracker — rastreador de coleção/trocas de cartas Pokémon TCG, UI em PT-BR, SPA React mobile-first. Frontend (raiz do repo, React 19 + Vite) nunca fala direto com APIs externas — sempre via backend Express (`server/`). Auth/dados de usuário em Supabase (Postgres + Auth). Deploy: frontend no Vercel (`tcgcolecionador.com.br`), backend no Render (`api.tcgcolecionador.com.br`).

## Funcionalidades implementadas

- **Coleção**: navegação por eras/coleções (mais recentes primeiro), busca de carta, marcar como possuída com toque rápido, "Selecionar Todos" de uma coleção.
- **+Info por carta**: gerenciamento fino de variação (Standard/Foil/Reverse Foil/Pokeball/Master Ball/First Edition) × condição (D/HP/MP/SP/NM) × quantidade × preço, com detalhamento opcional por **idioma** por variação/condição.
- **Coleções Orientais**: catálogo separado (TCGdex) pra cartas em japonês/idiomas orientais, com sua própria Home (`HomeViewJp.tsx`).
- **Trocas** (`TradesView.tsx`): pastas próprias e de amigos, "Pasta de Repetidas" automática, sistema de amizade por código, negociação de troca com máquina de estados (`pending_response` → pagamento em dinheiro ou oferta carta-por-carta → confirmação → `completed`), histórico de trocas. **Antes gateada atrás de "teste fechado" com código de acesso — esse bloqueio foi removido (ver Mudanças recentes), o app inteiro está liberado agora.**
- **Wishlist**: lista de desejos, priorizada na visualização de pasta de amigo.
- **Importação CSV**: em Opções, sobe uma coleção existente de outro app/planilha.
- **Exportar dados**: em Opções, baixa a coleção em JSON.
- **Preço de comunidade**: estatísticas de preço agregadas por carta/variação/condição.
- **App Android**: empacotado via Capacitor (`android/`), ícone/splash gerados a partir do logo, APK de debug já testado.
- **Views/modos**: alternância lista/grid-3/grid-6 (`viewMode.ts`, `CardViewModeSelector`), grid-6 é desktop-only.

## Integrações

- **Supabase** (Postgres + Auth) — projeto `ihaogdkyrsfiywqiuogs`, org "Rimandias's Org". MCP `Supabase` conectado nesta sessão (execute_sql, apply_migration, get_advisors etc.) — **não expõe e-mail de login/conta**, só dados do projeto.
- **Vercel** — hospeda o frontend, deploy automático a cada push em `main`. MCP `Vercel` disponível.
- **Render** — hospeda o backend (`srv-d9eluqernols73egp630`), **NÃO faz auto-deploy de mudanças de backend de forma confiável** — precisa disparar manualmente via API (`POST /v1/services/{id}/deploys`, chave em posse do assistente nesta sessão, não documentada aqui por segurança — repetir "dispare o deploy do Render" numa sessão nova se necessário).
- **GitHub** (`Rimandias/TCG-Collector`) — MCP `github` pra PRs/CI. Vercel roda como check obrigatório em todo PR.
- **TCGdex** — fonte do catálogo de cartas (ocidental e oriental), substituiu pokemontcg.io.
- Diversos outros MCPs conectados na conta mas **não usados neste projeto** (Canva, Figma, Notion, n8n, Gmail, Google Drive, Lovable, Indeed, Anthropic Economic Index, Context7, plugins ponytail/impeccable/etc.) — evitar carregá-los via ToolSearch à toa, cada um consome tokens de contexto quando referenciado.

## Diretrizes de trabalho (git e processo)

- Branch de trabalho: `claude/project-handoff-reading-97hut5`, PR pra `main`.
- **Padrão de squash-merge**: depois de todo merge, o commit squashado no GitHub recebe um SHA novo mesmo com conteúdo idêntico ao commit local — `git diff origin/main HEAD --stat` fica sujo/PR mostra arquivos antigos de novo se só der `git push`. Sempre reconstruir: `git fetch origin main -q && git checkout -B claude/project-handoff-reading-97hut5 origin/main -q && git commit --amend --no-edit --reset-author` (ou `git cherry-pick <sha>` se há commit novo em cima), confirmar `git diff origin/main HEAD --stat` vazio, então `git push --force-with-lease`.
- Antes de mesclar PR: sempre esperar `mergeable_state: "clean"` e CI (Vercel) `success` — nunca mesclar com `dirty`/`unknown`.
- Mudança em `server/`: **lembrar de disparar o deploy do Render manualmente** depois do merge (Vercel é automático, Render não).
- Sem suite de testes automatizada — verificação é `tsc --noEmit` + `npm run build` (frontend e backend) + teste manual/Playwright com conta descartável (`sergioriman+e2<label><timestamp>@gmail.com`, criada/apagada via Supabase admin API) contra dados reais do Supabase (não há seed/DB local).
- **Nunca mexer nestas contas reais**: `sergioriman@gmail.com` (dono), `darkangelsergio@hotmail.com`, `samir.rimandias@gmail.com`.
- Commits: só commitar quando pedido explicitamente; nunca `--amend` em commit já publicado (criar novo); mensagens em português, sem emoji.

## Mudanças recentes (mais novo primeiro)

1. **PR #31** — Removido o bloqueio de "teste fechado" (código de acesso) das Trocas e pastas de amigos a pedido do dono — `requirePremium` agora sempre libera, app inteiro disponível. Reversível (lógica de `isPremiumUser`/resgate de código continua no backend, só não é mais chamada).
2. **PR #30** — **Bug de perda de dados corrigido**: Supabase/PostgREST corta resultados em 1000 linhas por padrão sem paginação explícita. Conta real tinha 1001 cartas — 1 sempre ficava de fora do `GET`, e o próximo salvamento (de qualquer carta) apagava a que tinha ficado de fora. Corrigido com paginação explícita (`.range()`) em `assembleFullUser` e `syncKeyedTable`.
3. **PR #29** — **Bug de perda de dados corrigido**: corrida no salvamento (`replaceUserData`/`syncKeyedTable`) — duas escritas sobrepostas do mesmo usuário podiam se intercalar e uma apagar carta que a outra tinha acabado de salvar. Corrigido com fila em memória por usuário (processo roda `WEB_CONCURRENCY=1`, sem precisar de lock distribuído). **Limite conhecido**: não cobre sozinho duas sessões genuinamente divergentes salvando ao mesmo tempo (ex: app aberto no celular E no navegador) — isso exigiria mudar o protocolo de sync pra salvar só o delta, não a coleção inteira.
4. **PR #28** — Evitado salvamento desnecessário ao clicar "-"/ícone de idioma numa carta/condição já em 0 (o ícone de idioma chegava a reenviar o mesmo PUT a cada clique).
5. **PR #27** — Corrigido salvamento que ficava travado em "Salvando..." ao editar mais de uma carta antes do salvamento anterior terminar (edição nova não era reagendada).
6. **PR #26** — Auditoria de performance/escalabilidade: compressão gzip/brotli, `variations` esparso (não denso) no banco, resposta mínima do `PUT /api/users/me`, `Cache-Control` no catálogo, code-splitting, índice faltante em `friends.friend_user_id`, exportação de dados. Redução de banda de ~99% num caso típico.
7. **PR #25** e anteriores — ver `git log` no repo; cobrem migração TCGdex, Capacitor/Android, PostCSS, idioma por carta, coleções orientais, sistema de trocas completo, etc.

## Pendências / decisões em aberto

- **Recuperação de dados**: os bugs dos PRs #29/#30 já causaram perda real de cartas na conta do dono (ex: Rattata, Sandshrew do Base Set) **antes** da correção — não foram recuperadas automaticamente, precisam ser readicionadas manualmente. Perguntar se ainda há coleções incompletas.
- **Migração pra VPS**: discutido, recomendação foi NÃO migrar tudo agora (app em fase de estabilização, ganho de custo só compensa em escala) — se quiser resolver só o cold-start/hibernação do Render sem abrir mão do Supabase gerenciado, mover só o backend Express pra uma VPS barata é a opção de menor risco. Não implementado.
- **E-mail com domínio próprio** (`@tcgcolecionador.com.br`): Supabase não oferece isso. Opções levantadas: Zoho Mail (grátis), Cloudflare Email Routing (grátis, só encaminha), Google Workspace (pago). Não implementado — falta acesso ao DNS do domínio pra configurar.
- **Skill "ponytail"**: habilitada na conta mas comandos (`/ponytail-help` etc.) não carregam nesta sessão — provável necessidade de reiniciar sessão ou checar configuração de plugin por ambiente. Não resolvido.
- **README.md desatualizado**: ainda descreve arquitetura antiga (SQLite local) — o projeto migrou pra Supabase há tempo. Não corrigido ainda.
