'use strict';
const express = require('express');
const http = require('http');
const cors = require('cors');
const helmet = require('helmet');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { Server } = require('socket.io');
const crypto = require('crypto');

const PORT = Number(process.env.PORT || 10000);
const JWT_SECRET = process.env.JWT_SECRET || crypto.randomBytes(48).toString('hex');
const CLIENT_ORIGINS = (process.env.CLIENT_ORIGINS || '*').split(',').map(s => s.trim()).filter(Boolean);
const UPDATE_ADMIN_TOKEN = process.env.UPDATE_ADMIN_TOKEN || '';
const DEFAULT_GAME_VERSION = process.env.GAME_VERSION || '1.26.0';
const DEFAULT_CLIENT_URL = process.env.CLIENT_URL || '';
const SUPABASE_URL = String(process.env.SUPABASE_URL || '').replace(/\/$/, '');
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const persistentStorageEnabled = !!(SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY);

let updateManifest = {
  version: DEFAULT_GAME_VERSION,
  minVersion: process.env.MIN_GAME_VERSION || DEFAULT_GAME_VERSION,
  clientUrl: DEFAULT_CLIENT_URL,
  releaseNotes: process.env.RELEASE_NOTES || 'Version initiale du système de mises à jour.',
  publishedAt: new Date().toISOString(),
  previous: null,
  history: []
};

const updateHistory = [];
const versionStats = new Map();
const app = express();
const server = http.createServer(app);

const io = new Server(server, {
  cors: {
    origin: CLIENT_ORIGINS.includes('*') ? '*' : CLIENT_ORIGINS,
    methods: ['GET', 'POST']
  },
  transports: ['websocket', 'polling'],
  pingInterval: 25000,
  pingTimeout: 20000
});

app.use(helmet({ crossOriginResourcePolicy: false }));
app.use(cors({ origin: CLIENT_ORIGINS.includes('*') ? true : CLIENT_ORIGINS }));
app.use(express.json({ limit: '64kb' }));

// Les comptes actifs sont en mémoire et persistés dans Supabase.
// La clé service_role reste exclusivement côté serveur (variable Render).
const accounts = new Map();
const activePlayers = new Map();
const recoveryTickets = new Map();
const attempts = new Map();

async function supabaseRequest(path, options = {}) {
  if (!persistentStorageEnabled) return null;
  const response = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...options,
    headers: {
      apikey: SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      'Content-Type': 'application/json',
      ...(options.headers || {})
    }
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    throw new Error(`Supabase HTTP ${response.status}: ${detail.slice(0, 300)}`);
  }
  if (response.status === 204) return null;
  const body = await response.text();
  return body ? JSON.parse(body) : null;
}

function accountToRow(a) {
  return {
    phone: a.phone,
    email: a.email,
    password_hash: a.passwordHash,
    security: a.security || {},
    profile: a.profile || {},
    position: a.position || { x: 0, z: 0, yaw: 0 },
    needs: a.needs || null,
    save: a.save || null,
    created_at: a.createdAt ? new Date(a.createdAt).toISOString() : new Date().toISOString(),
    updated_at: new Date().toISOString()
  };
}

function rowToAccount(row) {
  return {
    phone: row.phone,
    email: row.email,
    passwordHash: row.password_hash,
    security: row.security || {},
    profile: row.profile || {},
    position: row.position || { x: 0, z: 0, yaw: 0 },
    needs: row.needs || null,
    save: row.save || null,
    createdAt: row.created_at ? new Date(row.created_at).getTime() : Date.now()
  };
}

async function persistAccount(account) {
  if (!persistentStorageEnabled) {
    throw new Error('Stockage Supabase non configuré : écriture refusée pour protéger les données.');
  }
  await supabaseRequest('game_accounts?on_conflict=phone', {
    method: 'POST',
    headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
    body: JSON.stringify(accountToRow(account))
  });
  return true;
}

async function loadPersistentAccounts() {
  if (!persistentStorageEnabled) {
    console.warn('SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY absents : stockage mémoire uniquement.');
    return;
  }
  const rows = await supabaseRequest('game_accounts?select=phone,email,password_hash,security,profile,position,needs,save,created_at');
  for (const row of rows || []) accounts.set(row.phone, rowToAccount(row));
  console.log(`Supabase connecté : ${accounts.size} compte(s) chargé(s).`);
}

const clean = (v, max = 80) => String(v ?? '').trim().slice(0, max);

function phoneOf(v) {
  let d = String(v || '').replace(/\D/g, '');
  if (d.startsWith('225') && d.length === 13) d = d.slice(3);
  return /^0[157]\d{8}$/.test(d) ? '+225' + d : null;
}

function answer(v) {
  return clean(v, 100).toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ');
}

function rateLimit(key, max = 12, windowMs = 60000) {
  const now = Date.now();
  const old = attempts.get(key) || { start: now, count: 0 };

  if (now - old.start > windowMs) {
    old.start = now;
    old.count = 0;
  }

  old.count++;
  attempts.set(key, old);
  return old.count <= max;
}

function publicPlayer(account, id) {
  return {
    id,
    profile: account.profile || {
      name: 'Citoyen',
      gender: 'homme',
      skin: 0x7a4a24,
      hair: 0x17120f,
      shirt: 0xe74c3c,
      pants: 0x2c3e50
    },
    position: account.position || { x: 0, z: 0, yaw: 0 },
    needs: account.needs || null
  };
}

function issueToken(phone) {
  return jwt.sign({ phone }, JWT_SECRET, {
    expiresIn: '7d',
    issuer: 'abidjan-life'
  });
}

function auth(req, res, next) {
  try {
    const raw = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
    const p = jwt.verify(raw, JWT_SECRET);
    req.phone = p.phone;

    if (!accounts.has(p.phone)) throw new Error('Compte introuvable.');

    next();
  } catch {
    res.status(401).json({ error: 'Session invalide. Reconnecte-toi.' });
  }
}

app.get('/', (_req, res) => res.json({
  name: 'Abidjan Life Online',
  status: 'ok',
  players: activePlayers.size,
  accounts: accounts.size,
  storage: persistentStorageEnabled ? 'supabase' : 'memory-only'
}));

app.get('/health', (_req, res) => res.status(200).json({
  ok: true,
  players: activePlayers.size,
  uptime: Math.round(process.uptime())
}));

// Le client interroge ce manifeste pour connaître la dernière version.
app.get('/api/updates/latest', (_req, res) =>
  res.set('Cache-Control', 'no-store, no-cache, must-revalidate').json({
    version: updateManifest.version,
    minVersion: updateManifest.minVersion,
    clientUrl: updateManifest.clientUrl,
    releaseNotes: updateManifest.releaseNotes,
    publishedAt: updateManifest.publishedAt,
    rollbackAvailable: !!updateManifest.previous
  })
);

app.get('/api/updates/history', (_req, res) =>
  res.set('Cache-Control', 'no-store').json({
    items: updateHistory.slice(-20).reverse().map(x => ({
      version: x.version,
      releaseNotes: x.releaseNotes,
      publishedAt: x.publishedAt
    }))
  })
);

function requireUpdateAdmin(req, res, next) {
  if (!UPDATE_ADMIN_TOKEN) {
    return res.status(503).json({
      error: 'Publication désactivée : configure UPDATE_ADMIN_TOKEN sur Render.'
    });
  }

  const supplied = String(req.get('x-update-admin-token') || '');

  if (
    supplied.length !== UPDATE_ADMIN_TOKEN.length ||
    !crypto.timingSafeEqual(Buffer.from(supplied), Buffer.from(UPDATE_ADMIN_TOKEN))
  ) {
    return res.status(403).json({ error: 'Accès administrateur refusé.' });
  }

  next();
}

app.get('/api/admin/updates/status', requireUpdateAdmin, (_req, res) => {
  const counts = {};

  for (const p of activePlayers.values()) {
    const v = p.version || 'inconnue';
    counts[v] = (counts[v] || 0) + 1;
  }

  res.set('Cache-Control', 'no-store').json({
    manifest: {
      version: updateManifest.version,
      minVersion: updateManifest.minVersion,
      clientUrl: updateManifest.clientUrl,
      releaseNotes: updateManifest.releaseNotes,
      publishedAt: updateManifest.publishedAt,
      rollbackAvailable: !!updateManifest.previous
    },
    playersOnline: activePlayers.size,
    accounts: accounts.size,
    playersByVersion: counts,
    history: updateHistory.slice(-20).reverse()
  });
});

app.post('/api/admin/updates/publish', requireUpdateAdmin, (req, res) => {
  const version = clean(req.body.version, 32);
  const clientUrl = clean(req.body.clientUrl || updateManifest.clientUrl, 500);
  const releaseNotes = clean(req.body.releaseNotes || 'Nouvelle version disponible.', 1000);
  const minVersion = clean(req.body.minVersion || version, 32);

  if (
    !/^\d+\.\d+\.\d+(?:-[a-z0-9.-]+)?$/i.test(version) ||
    !/^\d+\.\d+\.\d+(?:-[a-z0-9.-]+)?$/i.test(minVersion)
  ) {
    return res.status(400).json({
      error: 'Version invalide. Utilise le format 1.27.0.'
    });
  }

  if (!/^https:\/\//i.test(clientUrl)) {
    return res.status(400).json({
      error: 'Une URL HTTPS de déploiement Vercel est obligatoire.'
    });
  }

  try {
    const u = new URL(clientUrl);
    if (!u.hostname.endsWith('.vercel.app')) {
      return res.status(400).json({
        error: 'Utilise l’URL unique du déploiement Vercel, pas un alias de production.'
      });
    }
  } catch {
    return res.status(400).json({ error: 'URL de déploiement invalide.' });
  }

  if (version === updateManifest.version) {
    return res.status(409).json({ error: 'Cette version est déjà publiée.' });
  }

  const previous = {
    version: updateManifest.version,
    minVersion: updateManifest.minVersion,
    clientUrl: updateManifest.clientUrl,
    releaseNotes: updateManifest.releaseNotes,
    publishedAt: updateManifest.publishedAt
  };

  updateManifest = {
    version,
    minVersion,
    clientUrl,
    releaseNotes,
    publishedAt: new Date().toISOString(),
    previous
  };

  updateHistory.push({
    version,
    minVersion,
    clientUrl,
    releaseNotes,
    publishedAt: updateManifest.publishedAt,
    action: 'publication'
  });

  if (updateHistory.length > 50) updateHistory.shift();

  io.emit('update:available', {
    version,
    releaseNotes,
    publishedAt: updateManifest.publishedAt
  });

  res.json({
    ok: true,
    manifest: {
      version,
      minVersion,
      clientUrl,
      releaseNotes,
      publishedAt: updateManifest.publishedAt
    },
    rollbackAvailable: true
  });
});app.post('/api/admin/updates/rollback', requireUpdateAdmin, (req, res) => {
  if (!updateManifest.previous) {
    return res.status(409).json({
      error: 'Aucune version précédente disponible.'
    });
  }

  const restored = updateManifest.previous;

  updateManifest = {
    ...restored,
    previous: {
      version: updateManifest.version,
      minVersion: updateManifest.minVersion,
      clientUrl: updateManifest.clientUrl,
      releaseNotes: updateManifest.releaseNotes,
      publishedAt: updateManifest.publishedAt
    }
  };

  updateHistory.push({
    version: updateManifest.version,
    minVersion: updateManifest.minVersion,
    clientUrl: updateManifest.clientUrl,
    releaseNotes: 'Retour à la version précédente.',
    publishedAt: new Date().toISOString(),
    action: 'rollback'
  });

  if (updateHistory.length > 50) updateHistory.shift();

  io.emit('update:available', {
    version: updateManifest.version,
    releaseNotes: 'Retour à la version précédente.',
    publishedAt: updateManifest.publishedAt,
    rollback: true
  });

  res.json({
    ok: true,
    manifest: {
      version: updateManifest.version,
      minVersion: updateManifest.minVersion,
      clientUrl: updateManifest.clientUrl,
      releaseNotes: updateManifest.releaseNotes,
      publishedAt: updateManifest.publishedAt
    },
    rollbackAvailable: true
  });
});

app.post('/api/auth/register', async (req, res) => {
  const phone = phoneOf(req.body.phone);
  const password = String(req.body.password || '');
  const email = clean(req.body.email, 120).toLowerCase();
  const s = req.body.security || {};
  const day = Number(req.body.birthDay);
  const month = Number(req.body.birthMonth);

  if (!rateLimit(req.ip + ':register', 6)) {
    return res.status(429).json({
      error: 'Trop de créations de comptes. Réessaie dans une minute.'
    });
  }

  if (!phone) return res.status(400).json({ error: 'Numéro ivoirien invalide.' });

  if (password.length < 8 || password.length > 128) {
    return res.status(400).json({
      error: 'Mot de passe : 8 à 128 caractères.'
    });
  }

  if (!/^\S+@\S+\.\S{2,}$/.test(email)) {
    return res.status(400).json({ error: 'Adresse e-mail invalide.' });
  }

  if (
    !Number.isInteger(day) || day < 1 || day > 31 ||
    !Number.isInteger(month) || month < 1 || month > 12 ||
    answer(s.parentName).length < 2 ||
    !answer(s.petName) ||
    answer(s.sport).length < 2
  ) {
    return res.status(400).json({
      error: 'Date de naissance ou questions de récupération invalides.'
    });
  }

  if (accounts.has(phone)) {
    return res.status(409).json({
      error: 'Ce numéro possède déjà un compte.'
    });
  }

  if ([...accounts.values()].some(a => a.email === email)) {
    return res.status(409).json({
      error: 'Cette adresse e-mail est déjà utilisée.'
    });
  }

  const passwordHash = await bcrypt.hash(password, 12);

  const account = {
    phone,
    email,
    passwordHash,
    security: {
      birthDay: day,
      birthMonth: month,
      parentName: answer(s.parentName),
      petName: answer(s.petName),
      sport: answer(s.sport)
    },
    profile: {
      name: 'Mon personnage',
      gender: 'homme',
      skin: 0x7a4a24,
      hair: 0x17120f,
      shirt: 0xe74c3c,
      pants: 0x2c3e50
    },
    position: { x: 0, z: 0, yaw: 0 },
    needs: null,
    save: null,
    createdAt: Date.now()
  };

  try {
    await persistAccount(account);
  } catch (error) {
    console.error('Échec enregistrement nouveau compte:', error.message);
    return res.status(503).json({ error: 'Impossible de sécuriser le compte maintenant. Réessaie.' });
  }
  accounts.set(phone, account);

  res.status(201).json({
    token: issueToken(phone),
    player: {
      id: phone,
      profile: accounts.get(phone).profile,
      position: accounts.get(phone).position,
      save: null
    }
  });
});

app.post('/api/auth/migrate-local', async (req, res) => {
  const phone = phoneOf(req.body.phone);
  const password = String(req.body.password || '');
  const legacyHash = String(req.body.legacyPasswordHash || '');

  if (!rateLimit(req.ip + ':migrate', 8)) {
    return res.status(429).json({
      error: 'Trop de tentatives de migration.'
    });
  }

  if (!phone || password.length < 8 || accounts.has(phone)) {
    return res.status(400).json({
      error: 'Migration impossible ou compte déjà présent sur le serveur.'
    });
  }

  const actual = crypto.createHash('sha256')
    .update(password, 'utf8')
    .digest('hex');

  if (
    !/^[a-f0-9]{64}$/i.test(legacyHash) ||
    actual !== legacyHash.toLowerCase()
  ) {
    return res.status(401).json({
      error: 'Ancien mot de passe local incorrect. Ton compte local reste intact.'
    });
  }

  const email = clean(req.body.email, 120).toLowerCase();
  const s = req.body.security || {};

  if (
    !/^\S+@\S+\.\S{2,}$/.test(email) ||
    answer(s.parentName).length < 2 ||
    !answer(s.petName) ||
    answer(s.sport).length < 2
  ) {
    return res.status(400).json({
      error: 'Les informations de récupération du compte local sont incomplètes.'
    });
  }

  if ([...accounts.values()].some(a => a.email === email)) {
    return res.status(409).json({
      error: 'Cette adresse e-mail est déjà utilisée.'
    });
  }

  const save = req.body.save && typeof req.body.save === 'object'
    ? req.body.save
    : null;

  const profile = save?.playerProfile || {};

  const a = {
    phone,
    email,
    passwordHash: await bcrypt.hash(password, 12),
    security: {
      birthDay: Number(s.birthDay) || 1,
      birthMonth: Number(s.birthMonth) || 1,
      parentName: answer(s.parentName),
      petName: answer(s.petName),
      sport: answer(s.sport)
    },
    profile: {
      name: clean(profile.name, 24) || 'Mon personnage',
      gender: profile.gender === 'femme' ? 'femme' : 'homme',
      skin: Number(profile.skin) || 0x7a4a24,
      hair: Number(profile.hair) || 0x17120f,
      shirt: Number(profile.shirt) || 0xe74c3c,
      pants: Number(profile.pants) || 0x2c3e50
    },
    position: { x: 0, z: 0, yaw: 0 },
    needs: null,
    save,
    createdAt: Date.now(),
    migratedFromLocal: true
  };

  try {
    await persistAccount(a);
  } catch (error) {
    console.error('Échec enregistrement migration:', error.message);
    return res.status(503).json({ error: 'Impossible de sauvegarder le compte sur le serveur. Réessaie.' });
  }
  accounts.set(phone, a);

  res.status(201).json({
    token: issueToken(phone),
    player: { ...publicPlayer(a, phone), save: a.save }
  });
});

app.post('/api/auth/login', async (req, res) => {
  const phone = phoneOf(req.body.phone);
  const password = String(req.body.password || '');

  if (!rateLimit(req.ip + ':login', 15)) {
    return res.status(429).json({
      error: 'Trop de tentatives. Attends une minute.'
    });
  }

  const a = phone && accounts.get(phone);

  if (!a || !(await bcrypt.compare(password, a.passwordHash))) {
    return res.status(401).json({
      error: 'Numéro ou mot de passe incorrect.'
    });
  }

  res.json({
    token: issueToken(phone),
    player: { ...publicPlayer(a, phone), save: a.save }
  });
});

app.post('/api/auth/recover', (req, res) => {
  const phone = phoneOf(req.body.phone);
  const a = phone && accounts.get(phone);
  const s = req.body.security || {};

  if (!rateLimit(req.ip + ':recover', 8)) {
    return res.status(429).json({
      error: 'Trop de tentatives de récupération.'
    });
  }

  if (
    !a ||
    answer(s.parentName) !== a.security.parentName ||
    answer(s.petName) !== a.security.petName ||
    answer(s.sport) !== a.security.sport
  ) {
    return res.status(400).json({
      error: 'Numéro ou réponses de sécurité incorrects.'
    });
  }

  const ticket = crypto.randomBytes(32).toString('hex');

  recoveryTickets.set(ticket, {
    phone,
    expires: Date.now() + 10 * 60 * 1000
  });

  res.json({ recoveryTicket: ticket, expiresIn: 600 });
});

app.post('/api/auth/reset', async (req, res) => {
  const phone = phoneOf(req.body.phone);
  const ticket = recoveryTickets.get(String(req.body.recoveryTicket || ''));
  const password = String(req.body.password || '');

  if (!ticket || ticket.phone !== phone || ticket.expires < Date.now()) {
    return res.status(400).json({
      error: 'Vérification expirée. Recommence les questions de sécurité.'
    });
  }

  if (password.length < 8 || password.length > 128) {
    return res.status(400).json({
      error: 'Mot de passe : 8 à 128 caractères.'
    });
  }

  const a = accounts.get(phone);

  if (!a) return res.status(404).json({ error: 'Compte introuvable.' });

  const previousHash = a.passwordHash;
  a.passwordHash = await bcrypt.hash(password, 12);
  try {
    await persistAccount(a);
  } catch (error) {
    a.passwordHash = previousHash;
    console.error('Échec sauvegarde nouveau mot de passe:', error.message);
    return res.status(503).json({ error: 'Le nouveau mot de passe n’a pas pu être enregistré. Réessaie.' });
  }
  recoveryTickets.delete(String(req.body.recoveryTicket));

  res.json({ ok: true });
});

app.get('/api/me', auth, (req, res) =>
  res.json({ player: publicPlayer(accounts.get(req.phone), req.phone) })
);

io.use((socket, next) => {
  try {
    const token = socket.handshake.auth?.token;
    const p = jwt.verify(token, JWT_SECRET);

    if (!accounts.has(p.phone)) throw new Error('Compte absent');

    socket.phone = p.phone;
    next();
  } catch {
    next(new Error('Authentification requise'));
  }
});

io.on('connection', (socket) => {
  const account = accounts.get(socket.phone);

  // Un même compte ne peut pas contrôler deux avatars simultanément.
  for (const [id, p] of activePlayers) {
    if (p.phone === socket.phone) {
      io.to(id).emit('session:replaced');
      io.sockets.sockets.get(id)?.disconnect(true);
    }
  }

  const state = {
    id: socket.id,
    phone: socket.phone,
    profile: account.profile,
    position: account.position,
    needs: account.needs,
    version: clean(socket.handshake.auth?.gameVersion, 32) || 'inconnue',
    lastUpdate: 0,
    lastPersist: 0
  };

  activePlayers.set(socket.id, state);

  socket.emit(
    'world:players',
    [...activePlayers.values()]
      .filter(p => p.id !== socket.id)
      .map(p => ({
        id: p.id,
        profile: p.profile,
        position: p.position,
        needs: p.needs
      }))
  );

  socket.broadcast.emit('player:joined', {
    id: socket.id,
    profile: state.profile,
    position: state.position,
    needs: state.needs
  });

  socket.on('player:update', (payload = {}) => {
    if (payload.version) {
      state.version = clean(payload.version, 32) || state.version;
    }

    const now = Date.now();
    if (now - state.lastUpdate < 70) return;
    state.lastUpdate = now;

    const pos = payload.position || {};

    if (
      Number.isFinite(pos.x) &&
      Number.isFinite(pos.z) &&
      Math.abs(pos.x) <= 25000 &&
      Math.abs(pos.z) <= 25000
    ) {
      state.position = {
        x: pos.x,
        z: pos.z,
        yaw: Number.isFinite(pos.yaw) ? pos.yaw : 0
      };

      account.position = state.position;
    }

    if (payload.profile && typeof payload.profile === 'object') {
      const p = payload.profile;

      state.profile = account.profile = {
        name: clean(p.name, 24) || 'Citoyen',
        gender: p.gender === 'femme' ? 'femme' : 'homme',
        skin: Number(p.skin) || 0x7a4a24,
        hair: Number(p.hair) || 0x17120f,
        shirt: Number(p.shirt) || 0xe74c3c,
        pants: Number(p.pants) || 0x2c3e50
      };
    }

    if (payload.needs && typeof payload.needs === 'object') {
      const n = payload.needs;

      state.needs = account.needs = {
        hunger: clamp(n.hunger),
        energy: clamp(n.energy),
        social: clamp(n.social),
        health: clamp(n.health),
        money: clamp(n.money, 0, 1e12)
      };
    }

    socket.broadcast.emit('player:moved', {
      id: socket.id,
      profile: state.profile,
      position: state.position,
      needs: state.needs
    });

    if (persistentStorageEnabled && now - state.lastPersist >= 5000) {
      state.lastPersist = now;
      persistAccount(account).catch(error => console.error('Échec sauvegarde périodique:', error.message));
    }
  });

  socket.on('player:save', async (save, ack) => {
    let ok = false;

    if (
      save &&
      typeof save === 'object' &&
      JSON.stringify(save).length < 2000000
    ) {
      const previousSave = account.save;
      const previousPosition = account.position;
      const previousProfile = account.profile;
      const previousNeeds = account.needs;
      account.save = save;
      const savedPosition = save.worldPosition || save.position;
      if (savedPosition && Number.isFinite(savedPosition.x) && Number.isFinite(savedPosition.z) &&
          Math.abs(savedPosition.x) <= 25000 && Math.abs(savedPosition.z) <= 25000) {
        account.position = state.position = {
          x: savedPosition.x, z: savedPosition.z,
          yaw: Number.isFinite(savedPosition.yaw) ? savedPosition.yaw : 0
        };
      }
      if (save.playerProfile && typeof save.playerProfile === 'object') {
        const p = save.playerProfile;
        account.profile = state.profile = {
          name: clean(p.name, 24) || 'Citoyen',
          gender: p.gender === 'femme' ? 'femme' : 'homme',
          skin: Number(p.skin) || 0x7a4a24,
          hair: Number(p.hair) || 0x17120f,
          shirt: Number(p.shirt) || 0xe74c3c,
          pants: Number(p.pants) || 0x2c3e50
        };
      }
      if (['hunger','energy','social','health','money'].some(k => Number.isFinite(save[k]))) {
        account.needs = state.needs = {
          hunger: clamp(save.hunger), energy: clamp(save.energy),
          social: clamp(save.social), health: clamp(save.health),
          money: clamp(save.money, 0, 1e12)
        };
      }
      try {
        await persistAccount(account);
        ok = true;
      } catch (error) {
        account.save = previousSave;
        account.position = state.position = previousPosition;
        account.profile = state.profile = previousProfile;
        account.needs = state.needs = previousNeeds;
        console.error('Échec sauvegarde progression:', error.message);
      }
    }

    if (typeof ack === 'function') ack({ ok, persistent: persistentStorageEnabled });
  });

  socket.on('disconnect', () => {
    if (persistentStorageEnabled) {
      persistAccount(account).catch(error => console.error('Échec sauvegarde déconnexion:', error.message));
    }
    activePlayers.delete(socket.id);
    socket.broadcast.emit('player:left', socket.id);
  });
});

function clamp(v, min = 0, max = 100) {
  const n = Number(v);
  return Number.isFinite(n)
    ? Math.max(min, Math.min(max, n))
    : 0;
}

loadPersistentAccounts()
  .then(() => {
    server.listen(PORT, '0.0.0.0', () => {
      console.log(`Abidjan Life Online listening on ${PORT}`);
      console.log(`Stockage comptes : ${persistentStorageEnabled ? 'Supabase PostgreSQL' : 'mémoire uniquement (configuration requise)'}`);
    });
  })
  .catch(error => {
    console.error('Impossible de charger les comptes Supabase :', error.message);
    process.exit(1);
  });