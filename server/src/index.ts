import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { env } from './env.js';
import { tcgRouter } from './routes/tcg.js';
import { tcgJpRouter } from './routes/tcgJp.js';
import { usersRouter } from './routes/users.js';
import { friendsRouter } from './routes/friends.js';
import { tradesRouter } from './routes/trades.js';
import { premiumRouter } from './routes/premium.js';

const app = express();

app.disable('x-powered-by');
app.use(helmet());
app.use(
  cors({
    origin: env.clientOrigin,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
  })
);
app.use(express.json({ limit: '1mb' }));

// Alto porque esse limitador roda ANTES dos limitadores específicos de cada rota
// (ex: tcgLimiter) - se ficar mais baixo que eles, vira o teto efetivo e anula o
// ajuste feito lá. Serve só como rede de segurança básica contra bugs de loop
// infinito, não como proteção anti-abuso real (isso ficaria a cargo da infra).
const globalLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 2000,
  standardHeaders: true,
  legacyHeaders: false,
});
app.use(globalLimiter);

app.get('/api/health', (_req, res) => res.json({ ok: true }));

app.use('/api/tcg', tcgRouter);
app.use('/api/tcg-jp', tcgJpRouter);
app.use('/api/users', usersRouter);
app.use('/api/friends', friendsRouter);
app.use('/api/trades', tradesRouter);
app.use('/api/premium', premiumRouter);

app.use((req, res) => {
  res.status(404).json({ error: 'Rota não encontrada.' });
});

// eslint-disable-next-line @typescript-eslint/no-unused-vars
app.use((err: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error(err);
  res.status(500).json({ error: 'Erro interno do servidor.' });
});

app.listen(env.port, () => {
  console.log(`PokéTracker backend rodando em http://localhost:${env.port}`);
});
