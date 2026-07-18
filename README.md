<div align="center">
<img width="1200" height="475" alt="GHBanner" src="https://ai.google.dev/static/site-assets/images/share-ais-513315318.png" />
</div>

# Run and deploy your AI Studio app

This contains everything you need to run your app locally.

View your app in AI Studio: https://ai.studio/apps/3a71a4e0-c658-43fe-8369-dc8cdf7822cf

## Run Locally

**Prerequisites:**  Node.js

Este projeto agora é dividido em dois processos: o **frontend** (React + Vite, raiz do repo) e o **backend** (Express + SQLite, pasta `server/`). O frontend nunca fala diretamente com a Pokémon TCG API — todas as chamadas passam pelo backend, que guarda a chave de API em segredo e mantém o banco de dados local (SQLite) com contas de usuário e coleções.

### 1. Backend

```
cd server
npm install
cp .env.example .env   # ajuste JWT_SECRET e, se tiver, POKEMONTCG_API_KEY
npm run dev             # sobe em http://localhost:8787
```

O arquivo `server/data/poketracker.sqlite` é criado automaticamente na primeira execução.

### 2. Frontend

Em outro terminal, na raiz do projeto:

```
npm install
npm run dev              # sobe em http://localhost:3000
```

O Vite já está configurado para redirecionar chamadas `/api/*` para o backend (`http://localhost:8787`) durante o desenvolvimento — não é necessário configurar CORS manualmente nem expor nenhuma chave no navegador.

### Segurança

- A chave da Pokémon TCG API fica só em `server/.env` (arquivo ignorado pelo git), nunca no bundle do frontend.
- Login/registro usam senha com hash (bcrypt) e autenticação por JWT.
- Rotas sensíveis têm rate limiting e validação de entrada (zod).
