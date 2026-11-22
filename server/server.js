'use strict';
const express = require('express');
const http = require('http');
const cors = require('cors');
const helmet = require('helmet');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { Server } = require('socket.io');
const crypto = require('crypto');
const { multiplayerZone } = require('./spatial-zones');

const PORT = Number(process.env.PORT || 10000);
const JWT_SECRET = process.env.JWT_SECRET || crypto.randomBytes(48).toString('hex');
const CLIENT_ORIGINS = (process.env.CLIENT_ORIGINS || '*').split(',').map(s => s.trim()).filter(Boolean);
const UPDATE_ADMIN_TOKEN = process.env.UPDATE_ADMIN_TOKEN || '';
const OPENAI_API_KEY = process.env.OPENAI_API_KEY || '';
const OPENAI_MODEL = process.env.OPENAI_MODEL || 'gpt-6.2-astra';
const nodemailer = require('nodemailer');
const SMTP_HOST = process.env.SMTP_HOST || '';
const SMTP_PORT = Number(process.env.SMTP_PORT || 587);
const SMTP_USER = process.env.SMTP_USER || '';
const SMTP_PASS = process.env.SMTP_PASS || '';
const SMTP_FROM = process.env.SMTP_FROM || SMTP_USER;
const mailTransport = SMTP_HOST && SMTP_USER && SMTP_PASS ? nodemailer.createTransport({host:SMTP_HOST,port:SMTP_PORT,secure:SMTP_PORT===465,auth:{user:SMTP_USER,pass:SMTP_PASS}}) : null;
const DEFAULT_GAME_VERSION = process.env.GAME_VERSION || '1.41.3';
const DEFAULT_CLIENT_URL = process.env.CLIENT_URL || '';
const CLIENT_SIZE_BYTES = Math.max(0, Number(process.env.CLIENT_SIZE_BYTES) || 1059828);
const SUPABASE_URL = String(process.env.SUPABASE_URL || '').replace(/\/$/, '');
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const persistentStorageEnabled = !!(SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY);

let updateManifest = {
  version: DEFAULT_GAME_VERSION,
  minVersion: process.env.MIN_GAME_VERSION || DEFAULT_GAME_VERSION,
  clientUrl: DEFAULT_CLIENT_URL,
  releaseNotes: process.env.RELEASE_NOTES || 'V1.41.3 : installation des mises à jour fiabilisée, sans contrôle de téléchargement bloquant par CORS.',
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
let sharedWorldState = null;
let worldStateOwner = null;
function publicPlayer(p){return {id:p.id,profile:p.profile,position:p.position,needs:p.needs,vehicle:p.vehicle||null};}
function broadcastPlayerCount(){io.emit('players:count',{count:activePlayers.size});}

const recoveryTickets = new Map();
const emailRecoveryTickets = new Map();
const attempts = new Map();
const worldTelemetry = { npcTotal: 0, npcActive: 0, vehicles: {}, updatedAt: 0 };
const creatorReports = [];
function isCreatorPhone(phone) { return !!CREATOR_ACCOUNT_PHONE && phone === CREATOR_ACCOUNT_PHONE; }
function requireCreator(req,res,next) { if (!isCreatorPhone(req.phone)) return res.status(403).json({error:'Accès réservé au compte créateur officiel.'}); next(); }

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
  const reports = await supabaseRequest('creator_reports?select=id,created_at,player_name,player_phone,kind,message,version,district,status&order=created_at.desc&limit=500');
  creatorReports.splice(0, creatorReports.length, ...(reports || []).map(r => ({id:r.id,createdAt:r.created_at,player:r.player_name,phone:r.player_phone,kind:r.kind,message:r.message,version:r.version,district:r.district,status:r.status})));
  console.log(`Supabase connecté : ${accounts.size} compte(s) et ${creatorReports.length} signalement(s) chargés.`);
}

const clean = (v, max = 80) => String(v ?? '').trim().slice(0, max);

function phoneOf(v) {
  let d = String(v || '').replace(/\D/g, '');
  if (d.startsWith('225') && d.length === 13) d = d.slice(3);
  return /^0[157]\d{8}$/.test(d) ? '+225' + d : null;
}

const CREATOR_ACCOUNT_PHONE = phoneOf(process.env.CREATOR_ACCOUNT_PHONE || '');
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

function normalizePlayerName(value) {
  return clean(value, 24).normalize('NFD').replace(/[\\u0300-\\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]/g,'');
}
function nameDistance(a,b) {
  const row=Array.from({length:b.length+1},(_,i)=>i);
  for(let i=1;i<=a.length;i++){
    let prev=row[0];row[0]=i;
    for(let j=1;j<=b.length;j++){const cur=row[j];row[j]=Math.min(row[j]+1,row[j-1]+1,prev+(a[i-1]===b[j-1]?0:1));prev=cur;}
  }
  return row[b.length];
}
function isReservedCreatorName(value) {
  const n=normalizePlayerName(value), reserved='aski';
  return !n || n.includes('createur') || n.includes('creator') || n.includes(reserved) ||
    nameDistance(n,reserved)<=1 || (n.length>=5 && nameDistance(n,reserved)<=2);
}
function safePlayerName(phone, value) {
  if (isCreatorPhone(phone)) return 'Aski';
  const name = clean(value,24) || 'Citoyen';
  return isReservedCreatorName(name) ? 'Citoyen' : name;
}
function refreshCreatorGemBalance(account) {
  account.profile = account.profile || {};
  const now=Date.now();
  account.profile.creatorRewards=(account.profile.creatorRewards||[]).filter(x=>Number(x.expiresAt)>now);
  const timed=account.profile.creatorRewards.reduce((sum,x)=>sum+Math.max(0,Math.floor(Number(x.gems)||0)),0);
  account.profile.purchasedGems=Math.max(0,Math.floor(Number(account.profile.purchasedGems)||0));
  account.profile.earnedGems=Math.max(0,Math.floor(Number(account.profile.earnedGems)||0));
  account.profile.gems=timed+account.profile.purchasedGems+account.profile.earnedGems;
  return account.profile.gems;
}
function publicPlayer(account, id) {
  account.profile = account.profile || {};
  account.profile.name = safePlayerName(id, account.profile.name || 'Citoyen');
  refreshCreatorGemBalance(account);
  return {
    id,
    profile: account.profile,
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
    clientSizeBytes: CLIENT_SIZE_BYTES,
    publishedAt: updateManifest.publishedAt,
    rollbackAvailable: !!updateManifest.previous,
    previous: updateManifest.previous ? { version: updateManifest.previous.version, clientUrl: updateManifest.previous.clientUrl } : null
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
      clientSizeBytes: CLIENT_SIZE_BYTES,
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
    return res.status(400).json({ error: 'Une URL HTTPS de déploiement est obligatoire.' });
  }
  try {
    const u = new URL(clientUrl);
    if (!['vercel.app','pages.dev'].some(domain => u.hostname === domain || u.hostname.endsWith('.' + domain))) {
      return res.status(400).json({ error: 'Utilise une URL HTTPS Vercel ou Cloudflare Pages.' });
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
  io.emit('social:message', {
    id: 'update-' + version,
    from: 'system', fromName: 'AF GAMER CI',
    text: '📢 Nouvelle mise à jour Abidjan Life ' + version + ' disponible. ' + releaseNotes + ' Tu peux l’accepter maintenant ou la refuser temporairement ; elle sera installée automatiquement au retour au menu principal.',
    system: true, createdAt: Date.now()
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
  io.emit('social:message', {
    id: 'update-' + updateManifest.version,
    from: 'system', fromName: 'AF GAMER CI',
    text: '📢 La version d’Abidjan Life a été rétablie : ' + updateManifest.version + '. Le jeu appliquera cette version au retour au menu principal.',
    system: true, createdAt: Date.now()
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

app.post('/api/auth/register', async (req,res) => {
  if (!rateLimit(req.ip + ':register', 5, 60000)) return res.status(429).json({error:'Trop de créations de compte. Réessaie dans une minute.'});
  const phone=phoneOf(req.body.phone), password=String(req.body.password||'');
  const email=clean(req.body.email,120).toLowerCase();
  if(!phone) return res.status(400).json({error:'Numéro ivoirien invalide.'});
  if(isCreatorPhone(phone)) return res.status(403).json({error:'Le compte créateur officiel ne peut pas être créé ou revendiqué depuis l’inscription publique.'});
  if(password.length<8||password.length>128) return res.status(400).json({error:'Mot de passe : 8 à 128 caractères.'});
  if(email && !/^\S+@\S+\.\S{2,}$/.test(email)) return res.status(400).json({error:'Adresse e-mail invalide.'});
  if(accounts.has(phone)) return res.status(409).json({error:'Ce numéro possède déjà un compte. Connecte-toi.'});
  if(email && [...accounts.values()].some(a=>a.email===email)) return res.status(409).json({error:'Cette adresse e-mail est déjà utilisée.'});
  const account={phone,email:email||null,passwordHash:await bcrypt.hash(password,12),security:{},
    profile:{name:safePlayerName(phone,'Mon personnage'),gender:'homme',skin:0x7a4a24,hair:0x17120f,shirt:0xe74c3c,pants:0x2c3e50},
    position:{x:0,z:0,yaw:0},needs:null,save:null,createdAt:Date.now()};
  try { await persistAccount(account); }
  catch(error){ console.error('Échec enregistrement nouveau compte:',error.message); return res.status(503).json({error:'Impossible de sauvegarder le compte. Réessaie.'}); }
  accounts.set(phone,account);
  res.set('Cache-Control','no-store').status(201).json({token:issueToken(phone),player:{id:phone,profile:account.profile,position:account.position,save:null}});
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

  if (isCreatorPhone(phone)) {
    return res.status(403).json({error:'Le numéro créateur ne peut pas être revendiqué par une migration locale.'});
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

  if (!/^\S+@\S+\.\S{2,}$/.test(email)) {
    return res.status(400).json({error:'Adresse e-mail invalide.'});
  }

  if (email && [...accounts.values()].some(a => a.email === email)) {
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
    email: email || null,
    passwordHash: await bcrypt.hash(password, 12),
    security: {},
    profile: {
      name: safePlayerName(phone, profile.name || 'Mon personnage'),
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

app.post('/api/auth/recover-email', async (req,res) => {
  if (!rateLimit(req.ip+':recover-email',5,60000)) return res.status(429).json({error:'Trop de demandes. Réessaie dans une minute.'});
  if (!mailTransport) return res.status(503).json({error:'La récupération par e-mail attend la configuration SMTP sécurisée sur Render.'});
  const phone=phoneOf(req.body.phone),email=clean(req.body.email,120).toLowerCase();
  if (!phone || !/^\S+@\S+\.\S{2,}$/.test(email)) return res.status(400).json({error:'Saisis un numéro et une adresse e-mail valides.'});
  const account=accounts.get(phone);
  // Réponse identique que le compte existe ou non, pour éviter l'énumération.
  if (account && account.email===email) {
    const code=String(crypto.randomInt(0,1000000)).padStart(6,'0');
    const codeHash=crypto.createHash('sha256').update(phone+':'+email+':'+code+':'+JWT_SECRET).digest('hex');
    emailRecoveryTickets.set(phone,{email,codeHash,expires:Date.now()+10*60*1000,attempts:0});
    try {
      await mailTransport.sendMail({from:SMTP_FROM,to:email,subject:'Code de récupération Abidjan Life',text:'Ton code de récupération Abidjan Life est : '+code+'\nIl expire dans 10 minutes. Si tu n’as pas demandé ce code, ignore ce message.'});
    } catch(error) {
      emailRecoveryTickets.delete(phone);
      console.error('Envoi code récupération impossible:',error.message);
      return res.status(503).json({error:'Le code n’a pas pu être envoyé. Réessaie plus tard.'});
    }
  }
  res.set('Cache-Control','no-store').json({ok:true,message:'Si le numéro et l’adresse correspondent, un code de vérification vient d’être envoyé.'});
});
app.post('/api/auth/reset-email', async (req,res) => {
  if (!rateLimit(req.ip+':reset-email',8,60000)) return res.status(429).json({error:'Trop de tentatives. Réessaie dans une minute.'});
  const phone=phoneOf(req.body.phone),email=clean(req.body.email,120).toLowerCase();
  const code=String(req.body.code||'').replace(/\D/g,'').slice(0,6);
  const password=String(req.body.password||'');
  const ticket=phone&&emailRecoveryTickets.get(phone);
  if (!ticket || ticket.email!==email || ticket.expires<Date.now()) return res.status(400).json({error:'Code expiré ou invalide. Demande un nouveau code.'});
  if (++ticket.attempts>5) {emailRecoveryTickets.delete(phone);return res.status(429).json({error:'Trop de codes incorrects. Demande un nouveau code.'});}
  const expected=crypto.createHash('sha256').update(phone+':'+email+':'+code+':'+JWT_SECRET).digest('hex');
  const actual=crypto.createHash('sha256').update(phone+':'+email+':'+String(code)+':'+JWT_SECRET).digest('hex');
  if (!code || !crypto.timingSafeEqual(Buffer.from(ticket.codeHash),Buffer.from(actual))) return res.status(400).json({error:'Code incorrect.'});
  if (password.length<8 || password.length>128) return res.status(400).json({error:'Mot de passe : 8 à 128 caractères.'});
  const account=accounts.get(phone);
  if (!account || account.email!==email) return res.status(400).json({error:'Compte introuvable ou adresse non reconnue.'});
  const previousHash=account.passwordHash;
  account.passwordHash=await bcrypt.hash(password,12);
  try {await persistAccount(account);}
  catch(error) {account.passwordHash=previousHash;return res.status(503).json({error:'Le nouveau mot de passe n’a pas pu être enregistré.'});}
  emailRecoveryTickets.delete(phone);
  res.set('Cache-Control','no-store').json({ok:true});
});
// Suppression définitive du compte connecté et de toutes ses données de jeu.
app.delete('/api/account/me', auth, async (req, res) => {
  const phone = req.phone;
  const account = accounts.get(phone);
  if (!account) return res.status(404).json({ error: 'Compte introuvable.' });
  if (!persistentStorageEnabled) {
    return res.status(503).json({ error: 'Suppression sécurisée indisponible : stockage permanent non configuré.' });
  }
  try {
    await supabaseRequest('rpc/delete_game_account_data', {
      method: 'POST',
      body: JSON.stringify({ p_phone: phone })
    });
  } catch (error) {
    console.error('Échec suppression compte Supabase:', error.message);
    return res.status(503).json({ error: 'Le compte n’a pas pu être supprimé du stockage. Aucune déconnexion destructive n’a été effectuée.' });
  }
  // Retirer d'abord la source de vérité pour empêcher la sauvegarde lors du disconnect.
  accounts.delete(phone);
  for (const [ticket, item] of recoveryTickets) if (item.phone === phone) recoveryTickets.delete(ticket);
  for (const [id, player] of activePlayers) {
    if (player.phone !== phone) continue;
    io.to(id).emit('account:deleted');
    activePlayers.delete(id);
    io.sockets.sockets.get(id)?.disconnect(true);
    io.emit('player:left', id);
  }
  broadcastPlayerCount();
  res.set('Cache-Control', 'no-store').json({ ok: true, deleted: true });
});


// Outils privés du créateur : statistiques monde, signalements et assistant du jeu.
app.get('/api/creator/world', auth, requireCreator, (_req,res) => {
  const byVersion = {};
  for (const p of activePlayers.values()) byVersion[p.version || 'inconnue'] = (byVersion[p.version || 'inconnue'] || 0) + 1;
  res.set('Cache-Control','no-store').json({
    playersOnline: activePlayers.size,
    players: [...activePlayers.values()].map(p=>({name:clean(p.profile?.name,24)||'Citoyen',version:p.version||'inconnue'})),
    npcTotal: worldTelemetry.npcTotal,
    npcActive: worldTelemetry.npcActive,
    npcInactive: Math.max(0,worldTelemetry.npcTotal-worldTelemetry.npcActive),
    vehicles: worldTelemetry.vehicles,
    telemetryUpdatedAt: worldTelemetry.updatedAt || null,
    playersByVersion: byVersion
  });
});
app.get('/api/creator/reports', auth, requireCreator, (_req,res) => {
  res.set('Cache-Control','no-store').json({items:creatorReports.slice(-150).reverse().map(({phone,...report})=>report)});
});
app.post('/api/account/deletion-request', auth, async (req,res) => {
  if(!persistentStorageEnabled)return res.status(503).json({error:'Demandes indisponibles : stockage permanent non configuré.'});
  if(!rateLimit(req.phone+':account-deletion-request',3,60*60*1000))return res.status(429).json({error:'Une demande a déjà été envoyée récemment. Réessaie plus tard.'});
  const account=accounts.get(req.phone);
  if(!account)return res.status(404).json({error:'Compte introuvable.'});
  const subject='SUPPRESSION DE COMPTE';
  try{
    const previous=await supabaseRequest('afgamer_inbox?player_phone=eq.'+encodeURIComponent(req.phone)+'&category=eq.demande&subject=eq.'+encodeURIComponent(subject)+'&select=id,status&order=created_at.desc&limit=10');
    if((previous||[]).some(x=>['nouveau','en_cours'].includes(x.status)))return res.status(409).json({error:'Une demande de suppression est déjà en attente auprès d’AF GAMER.'});
    const player=clean(account.profile?.name,24)||'Citoyen';
    await supabaseRequest('afgamer_inbox',{method:'POST',headers:{Prefer:'return=minimal'},body:JSON.stringify([{player_name:player,player_phone:req.phone,category:'demande',subject,message:'Le joueur demande la suppression définitive de son compte et des données associées. La suppression attend la validation du créateur AF GAMER.',status:'nouveau'}])});
    io.emit('creator:account-deletion-request',{phone:req.phone});
    res.status(201).json({ok:true,message:'Ta demande a été transmise à AF GAMER. Ton compte reste actif jusqu’à son traitement.'});
  }catch(error){console.error('Demande suppression compte:',error.message);res.status(503).json({error:'Impossible d’enregistrer la demande. Réessaie plus tard.'});}
});

app.get('/api/creator/accounts', auth, requireCreator, (_req,res) => {
  res.set('Cache-Control','no-store').json({items:[...accounts.values()].map(a=>({phone:a.phone,name:clean(a.profile?.name,24)||'Citoyen',isCreator:isCreatorPhone(a.phone),createdAt:a.createdAt?new Date(a.createdAt).toISOString():null}))});
});

app.delete('/api/creator/accounts/:phone', auth, requireCreator, async (req,res) => {
  if(!persistentStorageEnabled)return res.status(503).json({error:'Suppression indisponible : stockage permanent non configuré.'});
  const phone=phoneOf(req.params.phone),confirmation=phoneOf(req.body.confirmPhone);
  if(!phone)return res.status(400).json({error:'Numéro de compte invalide.'});
  if(phone===req.phone)return res.status(403).json({error:'Le compte créateur ne peut pas être supprimé depuis cette liste.'});
  if(confirmation!==phone)return res.status(400).json({error:'Confirmation du numéro incorrecte.'});
  const account=accounts.get(phone);
  if(!account)return res.status(404).json({error:'Compte introuvable.'});
  try{
    await supabaseRequest('rpc/delete_game_account_data',{method:'POST',body:JSON.stringify({p_phone:phone})});
  }catch(error){console.error('Suppression administrative compte:',error.message);return res.status(503).json({error:'La suppression des données n’a pas été confirmée. Le compte reste intact.'});}
  accounts.delete(phone);
  for(const [ticket,item] of recoveryTickets)if(item.phone===phone)recoveryTickets.delete(ticket);
  for(const [id,player] of activePlayers){if(player.phone!==phone)continue;io.to(id).emit('account:deleted');activePlayers.delete(id);io.sockets.sockets.get(id)?.disconnect(true);io.emit('player:left',id);}
  broadcastPlayerCount();
  res.set('Cache-Control','no-store').json({ok:true,deleted:true,phone});
});

app.get('/api/creator/afgamer-inbox', auth, requireCreator, async (_req,res) => {
  if(!persistentStorageEnabled)return res.status(503).json({error:'Boîte AF_GAMER indisponible : stockage permanent non configuré.'});
  try{
    const rows=await supabaseRequest('afgamer_inbox?select=id,created_at,player_name,player_phone,category,subject,message,status,reply_text,replied_at&order=created_at.desc&limit=200');
    res.set('Cache-Control','no-store').json({items:(rows||[]).map(x=>({id:x.id,createdAt:x.created_at,player:x.player_name,phone:x.player_phone,category:x.category,subject:x.subject,message:x.message,status:x.status,reply:x.reply_text,repliedAt:x.replied_at}))});
  }catch(error){console.error('Lecture boîte AF_GAMER:',error.message);res.status(503).json({error:'Impossible de charger la boîte AF_GAMER.'});}
});
app.patch('/api/creator/afgamer-inbox/:id', auth, requireCreator, async (req,res) => {
  if(!persistentStorageEnabled)return res.status(503).json({error:'Stockage permanent non configuré.'});
  const id=clean(req.params.id,36),status=clean(req.body.status,20),reply=clean(req.body.reply,1200);
  if(!/^[0-9a-f-]{36}$/i.test(id))return res.status(400).json({error:'Identifiant de message invalide.'});
  if(!['nouveau','en_cours','traite','archive'].includes(status))return res.status(400).json({error:'Statut invalide.'});
  try{
    await supabaseRequest('afgamer_inbox?id=eq.'+encodeURIComponent(id),{method:'PATCH',headers:{Prefer:'return=minimal'},body:JSON.stringify({status,reply_text:reply,replied_at:reply?new Date().toISOString():null})});
    res.json({ok:true,message:'Dossier mis à jour.'});
  }catch(error){console.error('Mise à jour boîte AF_GAMER:',error.message);res.status(503).json({error:'Impossible de mettre à jour ce dossier.'});}
});
app.get('/api/game/afgamer-messages', auth, async (req,res) => {
  if(!persistentStorageEnabled)return res.status(503).json({error:'Historique indisponible : stockage permanent non configuré.'});
  try{
    const rows=await supabaseRequest('afgamer_inbox?player_phone=eq.'+encodeURIComponent(req.phone)+'&select=id,created_at,category,subject,message,status,reply_text,replied_at&order=created_at.desc&limit=30');
    res.set('Cache-Control','no-store').json({items:(rows||[]).map(x=>({id:x.id,createdAt:x.created_at,category:x.category,subject:x.subject,message:x.message,status:x.status,reply:x.reply_text,repliedAt:x.replied_at}))});
  }catch(error){console.error('Historique joueur AF_GAMER:',error.message);res.status(503).json({error:'Impossible de charger tes messages.'});}
});
app.post('/api/game/afgamer-message', auth, async (req,res) => {
  if(!persistentStorageEnabled)return res.status(503).json({error:'Envoi indisponible : stockage permanent non configuré.'});
  if(!rateLimit(req.phone+':afgamer-message',5,60000))return res.status(429).json({error:'Tu as envoyé trop de messages. Réessaie dans une minute.'});
  const category=req.body.category==='suggestion'?'suggestion':'demande';
  const subject=clean(req.body.subject,90);
  const message=clean(req.body.message,1200);
  if(!message)return res.status(400).json({error:'Écris un message avant de l’envoyer.'});
  if(category==='demande'&&subject.length<3)return res.status(400).json({error:'Précise l’objet de ta demande.'});
  const player=clean(accounts.get(req.phone)?.profile?.name,24)||'Citoyen';
  try{
    await supabaseRequest('afgamer_inbox',{method:'POST',headers:{Prefer:'return=minimal'},body:JSON.stringify([{player_name:player,player_phone:req.phone,category,subject,message,status:'nouveau'}])});
    res.status(201).json({ok:true,message:'Ton message a bien été transmis à AF GAMER CI.'});
  }catch(error){console.error('Envoi boîte AF_GAMER:',error.message);res.status(503).json({error:'Le message n’a pas pu être enregistré. Réessaie plus tard.'});}
});
app.post('/api/game/report', auth, async (req,res) => {
  if (!rateLimit(req.phone+':game-report',12,60000)) return res.status(429).json({error:'Trop de signalements. Réessaie plus tard.'});
  const message=clean(req.body.message,5000),kind=clean(req.body.kind,40)||'client-error';
  if(!message)return res.status(400).json({error:'Signalement vide.'});
  const report={id:crypto.randomUUID(),kind,message,player:clean(accounts.get(req.phone)?.profile?.name,24)||'Citoyen',phone:req.phone,version:clean(req.body.version,32),district:clean(req.body.district,80),createdAt:new Date().toISOString(),status:'nouveau'};
  if(persistentStorageEnabled){
    try{await supabaseRequest('creator_reports',{method:'POST',headers:{Prefer:'return=minimal'},body:JSON.stringify([{id:report.id,player_name:report.player,player_phone:report.phone,kind:report.kind,message:report.message,version:report.version,district:report.district,status:report.status,created_at:report.createdAt}])});}
    catch(error){console.error('Échec sauvegarde signalement:',error.message);return res.status(503).json({error:'Le signalement n’a pas pu être enregistré durablement.'});}
  }
  creatorReports.push(report);if(creatorReports.length>500)creatorReports.shift();
  io.emit('creator:report:new',{id:report.id});
  res.status(201).json({ok:true});
});
app.post('/api/game/assistant', auth, async (req,res) => {
  if(!rateLimit(req.phone+':game-ai',20,60000)) return res.status(429).json({error:'Tu poses trop de questions. Attends un instant.'});
  const question=clean(req.body.message,1800);
  const account=accounts.get(req.phone);
  const storedHistory=Array.isArray(account?.profile?.assistantMemory)?account.profile.assistantMemory:[];
  const clientHistory=Array.isArray(req.body.history)?req.body.history:[];
  const history=(storedHistory.length?storedHistory:clientHistory).slice(-8).map(m=>({role:m?.role==='assistant'?'assistant':'user',content:clean(m?.content,1200)})).filter(m=>m.content);
  if(!question) return res.status(400).json({error:'Écris une question.'});
  const knowledge=`Tu es l'assistant général d'Abidjan Life et l'assistant numérique du joueur. Tu peux répondre à des questions de culture générale, sciences, histoire, technologie, actualité, géographie, vie quotidienne et questions sur le jeu. Réponds en français sauf demande contraire. Pour les faits récents, les informations du monde réel, les prix, les lois ou les événements, utilise la recherche web disponible, compare les sources et donne des liens de sources dans ta réponse. Signale clairement les incertitudes et les dates. N'invente jamais de faits, de liens, de fonctions du jeu, de paiements ou de connexions. Distingue toujours ce qui existe réellement dans la version actuelle du jeu, ce qui est seulement simulé et ce qui est proposé pour plus tard. Abidjan Life est un jeu 3D situé à Abidjan avec déplacements, véhicules, PNJ, bâtiments, intérieurs, téléphone, services de vie, comptes et multijoueur. Les paiements Wave, les achats d'argent réel et les retraits ne sont pas encore activés. Tu peux expliquer, analyser, proposer des améliorations et rédiger des rapports, mais tu ne peux pas modifier le jeu ou effectuer une transaction par toi-même. Ne prétends pas apprendre ou modifier tes propres poids : tu peux utiliser le contexte de la conversation et les retours explicitement enregistrés par le système.`;
  if(!OPENAI_API_KEY) return res.json({answer:'Le service IA génératif n’est pas configuré sur le serveur. Les réponses locales restent limitées.',mode:'local-faq',note:'Configure OPENAI_API_KEY sur Render pour activer l’assistant avancé.'});
  try {
    const response=await fetch('https://api.openai.com/v1/responses',{
      method:'POST',
      headers:{Authorization:'Bearer '+OPENAI_API_KEY,'Content-Type':'application/json'},
      body:JSON.stringify({
        model:OPENAI_MODEL,
        tools:[{type:'web_search',search_context_size:'medium',user_location:{type:'approximate',country:'CI',city:'Abidjan',region:'Abidjan'}}],
        tool_choice:'auto',
        max_output_tokens:1100,
        input:[{role:'system',content:knowledge},...history,{role:'user',content:question}]
      })
    });
    const data=await response.json().catch(()=>({}));
    if(!response.ok) throw new Error(data.error?.message||'Service IA indisponible');
    const answerText=clean(data.output_text||(data.output||[]).flatMap(x=>x.content||[]).filter(x=>x.type==='output_text').map(x=>x.text).join('\n'),5000);
    const citations=(data.output||[]).flatMap(x=>x.content||[]).flatMap(x=>x.annotations||[]).filter(x=>x.type==='url_citation').map(x=>({title:clean(x.title,180),url:clean(x.url,500)})).filter(x=>/^https:\/\//.test(x.url)).slice(0,8);
    const finalAnswer=answerText||'Je n’ai pas trouvé de réponse fiable.';
    if(account){account.profile=account.profile||{};account.profile.assistantMemory=[...history,{role:'user',content:question},{role:'assistant',content:finalAnswer}].slice(-16);try{await persistAccount(account);}catch(memoryError){console.warn('Mémoire IA non persistée:',memoryError.message);}}
    res.set('Cache-Control','no-store').json({answer:finalAnswer,mode:'ai-web',citations});
  } catch(error) {
    console.error('Assistant IA:',error.message);
    res.status(503).json({error:'Assistant temporairement indisponible. '+clean(error.message,180)});
  }
});
function localGameAnswer(q){
 const t=q.toLowerCase();
 if(/commande|bouger|déplacer|touche/.test(t))return 'Déplace-toi avec ZQSD ou WASD, utilise la souris pour orienter la caméra et E pour interagir avec les portes, bâtiments et ascenseurs.';
 if(/wave|payer|paiement|argent/.test(t))return 'WaveABJ est une simulation interne : les achats se règlent avec l’argent du jeu. Aucun paiement réel n’est exécuté.';
 if(/sauveg|compte|connexion/.test(t))return 'Connecte-toi à ton compte pour retrouver ton personnage et ta progression. La sauvegarde en ligne dépend de la disponibilité du serveur et de Supabase.';
 if(/pnj|voiture|circulation|gbaka|taxi/.test(t))return 'La ville utilise des PNJ et des véhicules circulant sur le réseau routier OSM. Les véhicules comprennent notamment gbaka, taxis, motos, bus et voitures.';
 if(/multijoueur|joueur|connect/.test(t))return 'Le multijoueur synchronise les positions et profils des joueurs connectés. Une connexion stable au serveur est nécessaire.';
 return 'Je peux aider sur les déplacements, le téléphone, les comptes, les sauvegardes, la circulation, les PNJ, les bâtiments et le multijoueur. Pour une réponse plus précise, configure OPENAI_API_KEY sur le serveur.';
}
app.get('/api/account/role', auth, (req,res)=>{
  const creator=isCreatorPhone(req.phone);
  res.set('Cache-Control','no-store').json({ok:true,creator,title:creator?'Créateur du jeu':'Citoyen',privileges:creator?['creator_dashboard','account_management','moderation','world_management','creator_tools']:[]});
});
function ensureDailyMissionState(account){
  account.profile=account.profile||{};
  const today=new Date().toISOString().slice(0,10);
  let state=account.profile.dailyMissions;
  if(!state||state.date!==today){
    state={date:today,login:1,walkMeters:0,minutesPlayed:0,claimed:{}};
    account.profile.dailyMissions=state;
  }
  state.claimed=state.claimed&&typeof state.claimed==='object'?state.claimed:{};
  state.walkMeters=Math.max(0,Number(state.walkMeters)||0);
  state.minutesPlayed=Math.max(0,Number(state.minutesPlayed)||0);
  return state;
}
const DAILY_MISSIONS=[
  {id:'daily_login',title:'Se connecter à Abidjan',description:'Ouvre ta partie aujourd’hui.',target:1,reward:5,unit:'connexion'},
  {id:'daily_walk',title:'Découvrir la ville',description:'Parcours 500 mètres à pied dans Abidjan.',target:500,reward:15,unit:'m'},
  {id:'daily_play',title:'Prendre le temps de vivre',description:'Reste actif dans le monde pendant 10 minutes.',target:10,reward:10,unit:'min'}
];
const GEM_SUBSCRIPTIONS=[
  {id:'pass_citadin',name:'Pass Citadin',price:120,durationDays:7,multiplier:1.25,benefit:'25 % de gemmes supplémentaires sur les missions quotidiennes.'},
  {id:'pass_premium',name:'Pass Premium',price:600,durationDays:30,multiplier:1.5,benefit:'50 % de gemmes supplémentaires sur les missions quotidiennes.'}
];
app.get('/api/missions/daily',auth,async(req,res)=>{
  const account=accounts.get(req.phone),state=ensureDailyMissionState(account);
  try{await persistAccount(account);}catch(e){return res.status(503).json({error:'Progression quotidienne non sauvegardée.'});}
  const progress={daily_login:state.login,daily_walk:Math.floor(state.walkMeters),daily_play:Math.floor(state.minutesPlayed)};
  res.set('Cache-Control','no-store').json({
    date:state.date,gems:refreshCreatorGemBalance(account),
    missions:DAILY_MISSIONS.map(m=>({...m,progress:Math.min(m.target,progress[m.id]||0),claimed:!!state.claimed[m.id],completed:(progress[m.id]||0)>=m.target}))
  });
});

app.get('/api/subscriptions/me',auth,(req,res)=>{
  const account=accounts.get(req.phone),subscription=account.profile?.subscription||null;
  const active=subscription&&Number(subscription.expiresAt)>Date.now()?subscription:null;
  res.set('Cache-Control','no-store').json({gems:refreshCreatorGemBalance(account),subscription:active,plans:GEM_SUBSCRIPTIONS});
});
app.post('/api/subscriptions/purchase',auth,async(req,res)=>{
  const account=accounts.get(req.phone),plan=GEM_SUBSCRIPTIONS.find(p=>p.id===clean(req.body?.planId,40));
  if(!plan)return res.status(404).json({error:'Offre inconnue.'});
  account.profile=account.profile||{};
  const current=account.profile.subscription;
  if(current&&Number(current.expiresAt)>Date.now()&&current.planId!==plan.id)
    return res.status(409).json({error:'Ton abonnement actuel est encore actif. Attends son expiration avant de changer d’offre.'});
  const balance=refreshCreatorGemBalance(account);
  if(balance<plan.price)return res.status(400).json({error:'Gemmes insuffisantes pour cet abonnement.'});
  const previous=JSON.parse(JSON.stringify(account.profile));
  let remaining=plan.price;
  const purchased=Math.min(remaining,Number(account.profile.purchasedGems)||0);
  account.profile.purchasedGems=Math.max(0,(Number(account.profile.purchasedGems)||0)-purchased);remaining-=purchased;
  if(remaining){for(const reward of account.profile.creatorRewards||[]){const take=Math.min(remaining,Math.max(0,Number(reward.gems)||0));reward.gems-=take;remaining-=take;if(!remaining)break;}}
  if(remaining){const earned=Math.min(remaining,Number(account.profile.earnedGems)||0);account.profile.earnedGems=Math.max(0,(Number(account.profile.earnedGems)||0)-earned);remaining-=earned;}
  if(remaining){account.profile=previous;return res.status(409).json({error:'Solde de gemmes indisponible.'});}
  const now=Date.now(),start=current&&current.planId===plan.id&&Number(current.expiresAt)>now?Number(current.expiresAt):now;
  account.profile.subscription={planId:plan.id,name:plan.name,startedAt:current&&current.planId===plan.id?Number(current.startedAt)||now:now,expiresAt:start+plan.durationDays*86400000,multiplier:plan.multiplier};
  try{await persistAccount(account);}catch(error){account.profile=previous;return res.status(503).json({error:'Abonnement non enregistré. Aucun gemme n’a été conservée.'});}
  res.json({ok:true,subscription:account.profile.subscription,gems:refreshCreatorGemBalance(account)});
});
app.post('/api/missions/claim',auth,async(req,res)=>{
  const account=accounts.get(req.phone),state=ensureDailyMissionState(account);
  const id=clean(req.body?.id,40),mission=DAILY_MISSIONS.find(m=>m.id===id);
  if(!mission)return res.status(404).json({error:'Mission quotidienne inconnue.'});
  if(state.claimed[id])return res.status(409).json({error:'Cette récompense a déjà été récupérée aujourd’hui.'});
  const progress={daily_login:state.login,daily_walk:state.walkMeters,daily_play:state.minutesPlayed};
  if((Number(progress[id])||0)<mission.target)return res.status(409).json({error:'Mission pas encore terminée.'});
  const old=JSON.parse(JSON.stringify(account.profile));
  const subscription=account.profile.subscription;
  const active=subscription&&Number(subscription.expiresAt)>Date.now()?subscription:null;
  const multiplier=active?Math.max(1,Math.min(2,Number(active.multiplier)||1)):1;
  const reward=Math.floor(mission.reward*multiplier);
  account.profile.earnedGems=(Number(account.profile.earnedGems)||0)+reward;
  state.claimed[id]=Date.now();
  try{await persistAccount(account);}catch(error){account.profile=old;return res.status(503).json({error:'Récompense non sauvegardée. Réessaie.'});}
  res.json({ok:true,reward,baseReward:mission.reward,multiplier,gems:refreshCreatorGemBalance(account)});
});


app.get('/api/creator/rewards', auth, requireCreator, (_req,res)=>{
  const accountsList=[...accounts.values()].map(a=>{
    refreshCreatorGemBalance(a);
    return {name:a.profile?.name||'Citoyen',phone:a.phone,rewards:a.profile.creatorRewards||[],inbox:a.profile.rewardInbox||[],gems:a.profile.gems};
  });
  res.set('Cache-Control','no-store').json({ok:true,accounts:accountsList});
});
app.post('/api/creator/rewards', auth, requireCreator, async (req,res)=>{
  const targetPhone=phoneOf(req.body.phone),type=clean(req.body.type||'gems',20).toLowerCase();
  const amount=Math.max(0,Math.min(1000000000,Math.floor(Number(req.body.amount??req.body.gems)||0)));
  const days=Math.max(1,Math.min(365,Math.floor(Number(req.body.days)||30)));
  const label=clean(req.body.label,100)||'Récompense AF GAMER CI';
  const value=clean(req.body.value,120);
  const allowed=new Set(['gems','cash','bank','item','vehicle','property','business','custom']);
  const target=targetPhone&&accounts.get(targetPhone);
  if(!target)return res.status(404).json({error:'Compte joueur introuvable.'});
  if(!allowed.has(type))return res.status(400).json({error:'Type de récompense inconnu.'});
  if(['gems','cash','bank'].includes(type)&&amount<=0)return res.status(400).json({error:'Indique un montant supérieur à zéro.'});
  if(!['gems','cash','bank'].includes(type)&&!value&&!label)return res.status(400).json({error:'Décris la récompense.'});
  target.profile=target.profile||{};
  const previousRewards=target.profile.creatorRewards||[],previousInbox=target.profile.rewardInbox||[],previousGems=Number(target.profile.gems)||0;
  const reward={id:crypto.randomBytes(10).toString('hex'),type,label,value,amount,grantedAt:Date.now(),expiresAt:Date.now()+days*86400000,grantedBy:'Aski',status:'available'};
  if(type==='gems'){
    const gems=amount;
    target.profile.creatorRewards=[...previousRewards.filter(x=>Number(x.expiresAt)>Date.now()),{...reward,gems}].slice(-50);
    refreshCreatorGemBalance(target);
  }else{
    target.profile.rewardInbox=[...previousInbox.filter(x=>x&&x.status!=='expired'),reward].slice(-100);
  }
  try{await persistAccount(target);}catch(error){target.profile.creatorRewards=previousRewards;target.profile.rewardInbox=previousInbox;target.profile.gems=previousGems;return res.status(503).json({error:'La récompense n’a pas pu être sauvegardée.'});}
  res.json({ok:true,reward,target:{name:target.profile.name,phone:target.phone,gems:refreshCreatorGemBalance(target)}});
});
app.get('/api/rewards/me',auth,(req,res)=>{
  const account=accounts.get(req.phone);account.profile=account.profile||{};
  res.set('Cache-Control','no-store').json({gems:refreshCreatorGemBalance(account),gemRewards:(account.profile.creatorRewards||[]),rewards:(account.profile.rewardInbox||[]),vault:(account.profile.rewardVault||[])});
});
app.post('/api/rewards/claim',auth,async(req,res)=>{
  const account=accounts.get(req.phone);account.profile=account.profile||{};
  const id=clean(req.body.id,40),inbox=account.profile.rewardInbox||[],reward=inbox.find(x=>x.id===id);
  if(!reward)return res.status(404).json({error:'Récompense introuvable.'});
  if(reward.status==='claimed')return res.status(409).json({error:'Cette récompense a déjà été récupérée.'});
  if(Number(reward.expiresAt)<=Date.now()){reward.status='expired';try{await persistAccount(account);}catch(e){}return res.status(410).json({error:'Cette récompense a expiré.'});}
  const previousSave=account.save?JSON.parse(JSON.stringify(account.save)):null,previousProfile=JSON.parse(JSON.stringify(account.profile));
  account.save=account.save&&typeof account.save==='object'?account.save:{};
  let granted={type:reward.type,amount:reward.amount||0,label:reward.label};
  if(reward.type==='cash'||reward.type==='bank'){
    const key=reward.type==='cash'?'money':'bankBalance';
    account.save[key]=Math.max(0,Number(account.save[key])||0)+Math.max(0,Math.floor(Number(reward.amount)||0));
  }else{
    account.profile.rewardVault=account.profile.rewardVault||[];
    account.profile.rewardVault.push({id:reward.id,type:reward.type,label:reward.label,value:reward.value||'',claimedAt:Date.now(),grantedBy:reward.grantedBy||'AF GAMER'});
    account.profile.rewardVault=account.profile.rewardVault.slice(-200);
    if(reward.type==='gems')account.profile.purchasedGems=(Number(account.profile.purchasedGems)||0)+Math.max(0,Math.floor(Number(reward.amount)||0));
  }
  reward.status='claimed';reward.claimedAt=Date.now();
  try{await persistAccount(account);}catch(error){account.save=previousSave;account.profile=previousProfile;return res.status(503).json({error:'La récompense n’a pas pu être récupérée.'});}
  res.json({ok:true,granted,save:account.save,gems:refreshCreatorGemBalance(account)});
});
app.post('/api/rewards/exchange-gems',auth,async(req,res)=>{
  const account=accounts.get(req.phone);account.profile=account.profile||{};
  const amount=Math.max(0,Math.min(100000,Math.floor(Number(req.body.gems)||0)));
  if(!amount)return res.status(400).json({error:'Indique le nombre de gemmes à convertir.'});
  const balance=refreshCreatorGemBalance(account);
  if(amount>balance)return res.status(400).json({error:'Solde de gemmes insuffisant.'});
  const previousProfile=JSON.parse(JSON.stringify(account.profile)),previousSave=account.save?JSON.parse(JSON.stringify(account.save)):null;
  let remaining=amount;
  const purchased=Math.min(remaining,Number(account.profile.purchasedGems)||0);
  account.profile.purchasedGems=Math.max(0,(Number(account.profile.purchasedGems)||0)-purchased);remaining-=purchased;
  if(remaining){for(const reward of account.profile.creatorRewards||[]){const take=Math.min(remaining,Math.max(0,Number(reward.gems)||0));reward.gems-=take;remaining-=take;if(!remaining)break;}}
  if(remaining){
    const earned=Math.min(remaining,Number(account.profile.earnedGems)||0);
    account.profile.earnedGems=Math.max(0,(Number(account.profile.earnedGems)||0)-earned);
    remaining-=earned;
  }
  if(remaining){account.profile=previousProfile;return res.status(409).json({error:'Solde de gemmes indisponible.'});}
  account.save=account.save&&typeof account.save==='object'?account.save:{};
  const gameMoney=amount*1000000;
  account.save.bankBalance=Math.max(0,Number(account.save.bankBalance)||0)+gameMoney;
  refreshCreatorGemBalance(account);
  try{await persistAccount(account);}catch(error){account.profile=previousProfile;account.save=previousSave;return res.status(503).json({error:'Conversion impossible à sauvegarder.'});}
  res.json({ok:true,gems:account.profile.gems,gameMoney,rate:1000000,save:account.save});
});
app.get('/api/creator/status', auth, requireCreator, (_req,res)=>res.json({ok:true,creator:true,configuredAI:!!OPENAI_API_KEY}));

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


app.get('/api/players', (_req, res) => {
  // Le carnet public a seulement besoin de l'identifiant de session et du nom.
  // Ne jamais exposer les positions précises, véhicules ou profils complets via cet endpoint.
  res.set('Cache-Control', 'no-store');
  res.json({ count: activePlayers.size, players: [...activePlayers.values()].map(p => ({
    id: p.id,
    name: clean(p.profile?.name, 24) || 'Citoyen',
    moving: !!p.moving
  })) });
});

// Horloge et calendrier officiels : UTC = heure légale de Côte d’Ivoire.
function officialWorldClock(){return {iso:new Date().toISOString(),timezone:'Africa/Abidjan'};}
setInterval(()=>io.emit('world:clock',officialWorldClock()),1000).unref?.();

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
    zone: multiplayerZone(account.position),
    needs: account.needs,
    vehicle: null,
    moving: false,
    version: clean(socket.handshake.auth?.gameVersion, 32) || 'inconnue',
    lastUpdate: 0,
    lastPersist: 0,
    lastWorldSync: 0,
    lastMissionMinute: Math.floor(Date.now()/60000)
  };

  activePlayers.set(socket.id, state);
  socket.join('world:all');
  if (!worldStateOwner) worldStateOwner = socket.id;
  socket.emit('world:host', { id: worldStateOwner });
  socket.emit('world:clock', officialWorldClock());
  if (sharedWorldState) socket.emit('world:state', sharedWorldState);
  broadcastPlayerCount();

  socket.emit(
    'world:players',
    [...activePlayers.values()]
      .filter(p => p.id !== socket.id)
      .map(p => ({
        id: p.id,
        profile: p.profile,
        position: p.position,
        needs: p.needs,
        moving: !!p.moving,
        vehicle: p.vehicle || null
      }))
  );

  io.to('world:all').except(socket.id).emit('player:joined', {
    id: socket.id,
    profile: state.profile,
    position: state.position,
    needs: state.needs,
    moving: !!state.moving,
    vehicle: state.vehicle
  });

  socket.on('social:message',(payload={},ack)=>{
    const target=String(payload.to||'');
    const text=clean(payload.text,500);
    if(!target||target===socket.id||!text||!activePlayers.has(target)){if(typeof ack==='function')ack({ok:false,error:'Joueur indisponible.'});return;}
    const message={id:crypto.randomBytes(8).toString('hex'),from:socket.id,fromName:clean(state.profile?.name,24)||'Citoyen',text,createdAt:Date.now()};
    io.to(target).emit('social:message',message);
    if(typeof ack==='function')ack({ok:true,message});
  });
  socket.on('social:call',(payload={},ack)=>{
    const target=String(payload.to||'');
    if(!target||target===socket.id||!activePlayers.has(target)){if(typeof ack==='function')ack({ok:false,error:'Joueur indisponible.'});return;}
    io.to(target).emit('social:call',{from:socket.id,fromName:clean(state.profile?.name,24)||'Citoyen',createdAt:Date.now()});
    if(typeof ack==='function')ack({ok:true});
  });
  socket.on('world:telemetry', payload => {
    if (socket.id !== worldStateOwner || !payload || typeof payload !== 'object') return;
    const vehicles = payload.vehicles && typeof payload.vehicles === 'object' ? payload.vehicles : {};
    const safeVehicles = {};
    for (const key of ['gbaka','taxi','yango','woro','moto_livreur','moto','bus','voiture','luxe']) safeVehicles[key] = Math.max(0,Math.min(5000,Math.floor(Number(vehicles[key])||0)));
    worldTelemetry.npcTotal = Math.max(0,Math.min(10000,Math.floor(Number(payload.npcTotal)||0)));
    worldTelemetry.npcActive = Math.max(0,Math.min(worldTelemetry.npcTotal,Math.floor(Number(payload.npcActive)||0)));
    worldTelemetry.vehicles = safeVehicles;
    worldTelemetry.updatedAt = Date.now();
  });
  socket.on('creator:helicopter', (payload = {}) => {
    if (!isCreatorPhone(socket.phone)) return;
    const p=payload.position||{};
    if (![p.x,p.y,p.z,p.yaw].every(Number.isFinite)) return;
    if (Math.abs(p.x)>25000||Math.abs(p.z)>25000||p.y<2||p.y>180) return;
    const helicopter={owner:socket.id,ownerName:clean(state.profile?.name,24)||'Aski',
      position:{x:p.x,y:p.y,z:p.z,yaw:p.yaw},rotor:Number.isFinite(payload.rotor)?payload.rotor:0,updatedAt:Date.now()};
    io.emit('creator:helicopter',helicopter);
  });
  socket.on('creator:helicopter:stop', () => {
    if (isCreatorPhone(socket.phone)) io.emit('creator:helicopter:stop',{owner:socket.id});
  });
  socket.on('player:update', (payload = {}) => {
    if (payload.version) {
      state.version = clean(payload.version, 32) || state.version;
    }

    const now = Date.now();
    if (now - state.lastUpdate < 45) return;
    state.lastUpdate = now;

    const pos = payload.position || {};

    if (
      Number.isFinite(pos.x) &&
      Number.isFinite(pos.z) &&
      Math.abs(pos.x) <= 25000 &&
      Math.abs(pos.z) <= 25000
    ) {
      const previousPosition=state.position||{x:pos.x,z:pos.z};
      const travelled=Math.hypot(pos.x-(Number(previousPosition.x)||0),pos.z-(Number(previousPosition.z)||0));
      if(!payload.vehicle&&travelled>0.03&&travelled<10){
        const missionState=ensureDailyMissionState(account);
        missionState.walkMeters=Math.min(100000,missionState.walkMeters+travelled);
      }
      const currentMinute=Math.floor(Date.now()/60000);
      if(currentMinute>(state.lastMissionMinute||currentMinute)){
        const missionState=ensureDailyMissionState(account);
        missionState.minutesPlayed=Math.min(1440,missionState.minutesPlayed+Math.min(1,currentMinute-state.lastMissionMinute));
        state.lastMissionMinute=currentMinute;
      }
      state.moving = travelled > 0.025;
      state.position = {
        x: pos.x,
        z: pos.z,
        yaw: Number.isFinite(pos.yaw) ? pos.yaw : 0
      };

      account.position = state.position;
      const nextZone = multiplayerZone(state.position);
      if (nextZone !== state.zone) state.zone = nextZone;
    }

    if (payload.profile && typeof payload.profile === 'object') {
      const p = payload.profile;

      state.profile = account.profile = {
        name: safePlayerName(socket.phone, p.name),
        gender: p.gender === 'femme' ? 'femme' : 'homme',
        skin: Number(p.skin) || 0x7a4a24,
        hair: Number(p.hair) || 0x17120f,
        shirt: Number(p.shirt) || 0xe74c3c,
        pants: Number(p.pants) || 0x2c3e50,
        bodyType: ['fin','standard','athletique','fort'].includes(p.bodyType) ? p.bodyType : 'standard',
        hairstyle: ['court','degrade','afro','tresses','long'].includes(p.hairstyle) ? p.hairstyle : 'court',
        outfit: ['urbain','chic','sport'].includes(p.outfit) ? p.outfit : 'urbain'
      };
    }

    if (payload.vehicle && typeof payload.vehicle === 'object') {
      const v = payload.vehicle;
      state.vehicle = Number.isFinite(v.x) && Number.isFinite(v.z) ? {
        kind: 'yango', x: v.x, z: v.z,
        yaw: Number.isFinite(v.yaw) ? v.yaw : 0,
        boarded: !!v.boarded, phase: clean(v.phase, 20)
      } : null;
    } else state.vehicle = null;

    if (payload.worldState && socket.id === worldStateOwner) {
      const w = payload.worldState;
      const nowWorld = Date.now();
      if (nowWorld - state.lastWorldSync > 850 && Number.isFinite(w.hour) && Number.isFinite(w.minute)) {
        sharedWorldState = {
          hour: Math.max(0, Math.min(23, Math.floor(w.hour))),
          minute: Math.max(0, Math.min(59.99, Number(w.minute))),
          weather: ['pluie','tres-chaud','chaud','ensoleille'].includes(w.weather) ? w.weather : 'ensoleille',
          temperature: Math.max(15, Math.min(50, Number(w.temperature) || 31)),
          updatedAt: nowWorld
        };
        state.lastWorldSync = nowWorld;
        socket.broadcast.emit('world:state', sharedWorldState);
      }
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

    io.to('world:all').except(socket.id).emit('player:moved', {
      id: socket.id,
      profile: state.profile,
      position: state.position,
      needs: state.needs,
      moving: !!state.moving,
      vehicle: state.vehicle
    });

    if (persistentStorageEnabled && accounts.has(socket.phone) && now - state.lastPersist >= 5000) {
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
          name: safePlayerName(socket.phone, p.name),
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
    if (persistentStorageEnabled && accounts.has(socket.phone)) {
      persistAccount(account).catch(error => console.error('Échec sauvegarde déconnexion:', error.message));
    }
    activePlayers.delete(socket.id);
    io.to('world:all').except(socket.id).emit('player:left', socket.id);
    if (worldStateOwner === socket.id) {
      worldStateOwner = activePlayers.keys().next().value || null;
      if (worldStateOwner) io.to(worldStateOwner).emit('world:host', { id: worldStateOwner });
    }
    broadcastPlayerCount();
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