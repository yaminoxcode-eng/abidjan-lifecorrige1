'use strict';

function registerPlayerSystems(app, { auth, accounts, supabaseRequest, persistAccount, persistentStorageEnabled }) {
  const jsonSize = value => {
    try { return JSON.stringify(value).length; } catch { return Infinity; }
  };
  const safeText = (value, max = 80) => String(value == null ? '' : value).trim().slice(0, max);
  const requireStorage = (res) => {
    if (!persistentStorageEnabled || !supabaseRequest) { res.status(503).json({ error: 'Stockage permanent indisponible.' }); return false; }
    return true;
  };

  // One authenticated restore request for the persistent phone/game systems.
  app.get('/api/game/state', auth, async (req, res) => {
    if (!requireStorage(res)) return;
    const player = encodeURIComponent(req.phone);
    try {
      const [events, services, invoices, devices] = await Promise.all([
        supabaseRequest('player_action_events?player_phone=eq.' + player + '&select=event_key,event_type,payload,created_at&order=created_at.desc&limit=500'),
        supabaseRequest('player_services?player_phone=eq.' + player + '&select=service_key,status,activated_game_day,expires_game_day,last_code_game_month,metadata'),
        supabaseRequest('player_invoices?player_phone=eq.' + player + '&select=id,provider,invoice_type,amount_fcfa,billing_game_day,due_game_day,status,paid_at,payment_method,metadata&order=created_at.desc&limit=100'),
        supabaseRequest('player_devices?player_phone=eq.' + player + '&owned=eq.true&select=device_id,device_type,equipped,appearance&order=updated_at.desc')
      ]);
      res.set('Cache-Control', 'no-store').json({
        ok: true, events: events || [], services: services || [],
        invoices: invoices || [], devices: devices || []
      });
    } catch (error) {
      console.error('Restauration systèmes joueur:', error.message);
      res.status(503).json({ error: 'Restauration momentanément indisponible.' });
    }
  });

  app.get('/api/game/devices', auth, async (req, res) => {
    if (!requireStorage(res)) return;
    try {
      const rows = await supabaseRequest('player_devices?player_phone=eq.' + encodeURIComponent(req.phone) +
        '&owned=eq.true&select=device_id,device_type,equipped,appearance&order=updated_at.desc');
      res.set('Cache-Control', 'no-store').json({ items: rows || [] });
    } catch (error) {
      console.error('Lecture appareils joueur:', error.message);
      res.status(503).json({ error: 'Inventaire des appareils momentanément indisponible.' });
    }
  });

  app.post('/api/game/events', auth, async (req, res) => {
    if (!requireStorage(res)) return;
    const eventType = safeText(req.body?.eventType, 48);
    const eventKey = safeText(req.body?.eventKey, 100);
    const payload = req.body?.payload && typeof req.body.payload === 'object' ? req.body.payload : {};
    if (!/^[a-z0-9_.:-]{2,48}$/i.test(eventType) || !eventKey || jsonSize(payload) > 24000) {
      return res.status(400).json({ error: 'Événement invalide.' });
    }
    try {
      await supabaseRequest('player_action_events?on_conflict=player_phone,event_key', {
        method: 'POST',
        headers: { Prefer: 'resolution=ignore-duplicates,return=minimal' },
        body: JSON.stringify({ player_phone: req.phone, event_key: eventKey, event_type: eventType, payload })
      });
      // Phone ownership/equipment is materialized in the inventory table as well as the event ledger.
      if (eventType === 'device.store' || eventType === 'device.equip') {
        const deviceId = safeText(payload.deviceId, 64);
        const deviceType = safeText(payload.deviceType, 24);
        const appearance = payload.appearance && typeof payload.appearance === 'object' ? payload.appearance : {};
        if (!deviceId || !['phone','computer','tablet'].includes(deviceType) || jsonSize(appearance) > 8000) {
          return res.status(400).json({ error: 'Données d’appareil invalides.' });
        }
        if (eventType === 'device.equip') {
          await supabaseRequest('player_devices?player_phone=eq.' + encodeURIComponent(req.phone) +
            '&device_type=eq.' + encodeURIComponent(deviceType), {
            method: 'PATCH', headers: { Prefer: 'return=minimal' },
            body: JSON.stringify({ equipped: false, updated_at: new Date().toISOString() })
          });
        }
        await supabaseRequest('player_devices?on_conflict=player_phone,device_id', {
          method: 'POST',
          headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
          body: JSON.stringify({
            player_phone: req.phone, device_id: deviceId, device_type: deviceType,
            owned: true, equipped: eventType === 'device.equip', appearance,
            updated_at: new Date().toISOString()
          })
        });
      }
      res.status(202).json({ ok: true });
    } catch (error) {
      console.error('Journal joueur:', error.message);
      res.status(503).json({ error: 'Action reçue localement, synchronisation à réessayer.' });
    }
  });

  app.get('/api/game/events', auth, async (req, res) => {
    if (!requireStorage(res)) return;
    try {
      const rows = await supabaseRequest('player_action_events?player_phone=eq.' + encodeURIComponent(req.phone) +
        '&select=event_key,event_type,payload,created_at&order=created_at.desc&limit=250');
      res.set('Cache-Control', 'no-store').json({ items: rows || [] });
    } catch (error) {
      console.error('Lecture journal joueur:', error.message);
      res.status(503).json({ error: 'Historique momentanément indisponible.' });
    }
  });

  app.get('/api/game/services', auth, async (req, res) => {
    if (!requireStorage(res)) return;
    try {
      const rows = await supabaseRequest('player_services?player_phone=eq.' + encodeURIComponent(req.phone) +
        '&select=service_key,status,activated_game_day,expires_game_day,last_code_game_month,metadata');
      res.set('Cache-Control', 'no-store').json({ items: rows || [] });
    } catch (error) {
      console.error('Lecture services joueur:', error.message);
      res.status(503).json({ error: 'Services momentanément indisponibles.' });
    }
  });

  app.post('/api/game/services/activate', auth, async (req, res) => {
    if (!requireStorage(res)) return;
    const code = safeText(req.body?.code, 24);
    const gameDay = Math.max(1, Math.floor(Number(req.body?.gameDay) || 1));
    const gameMonth = Math.max(1, Math.floor(Number(req.body?.gameMonth) || 1));
    if (code !== '#1324564#') return res.status(400).json({ error: 'Code de service invalide.' });
    try {
      const previous = await supabaseRequest('player_services?player_phone=eq.' + encodeURIComponent(req.phone) +
        '&service_key=eq.internet&select=last_code_game_month,expires_game_day&limit=1');
      const current = previous?.[0];
      if (current && Number(current.last_code_game_month) === gameMonth) {
        return res.status(409).json({ error: 'Le code Internet a déjà été utilisé pendant ce mois du jeu.' });
      }
      const service = {
        player_phone: req.phone, service_key: 'internet', status: 'active',
        activated_game_day: gameDay, expires_game_day: gameDay + 28,
        last_code_game_month: gameMonth, metadata: { activation: 'ussd' }, updated_at: new Date().toISOString()
      };
      await supabaseRequest('player_services?on_conflict=player_phone,service_key', {
        method: 'POST',
        headers: { Prefer: 'resolution=merge-duplicates,return=representation' },
        body: JSON.stringify(service)
      });
      res.status(201).json({ ok: true, service: { key: 'internet', expiresGameDay: gameDay + 28 } });
    } catch (error) {
      console.error('Activation Internet:', error.message);
      res.status(503).json({ error: 'Activation impossible pour le moment.' });
    }
  });

  app.get('/api/game/invoices', auth, async (req, res) => {
    if (!requireStorage(res)) return;
    try {
      const rows = await supabaseRequest('player_invoices?player_phone=eq.' + encodeURIComponent(req.phone) +
        '&select=id,provider,invoice_type,amount_fcfa,billing_game_day,due_game_day,status,paid_at,payment_method,metadata&order=created_at.desc&limit=100');
      res.set('Cache-Control', 'no-store').json({ items: rows || [] });
    } catch (error) {
      console.error('Lecture factures:', error.message);
      res.status(503).json({ error: 'Factures momentanément indisponibles.' });
    }
  });

  app.post('/api/game/invoices', auth, async (req, res) => {
    if (!requireStorage(res)) return;
    const provider = safeText(req.body?.provider, 24).toLowerCase();
    const invoiceType = safeText(req.body?.invoiceType, 32).toLowerCase();
    const amount = Math.floor(Number(req.body?.amountFcfa));
    const billingDay = Math.max(1, Math.floor(Number(req.body?.billingGameDay) || 1));
    const dueDay = Math.max(billingDay, Math.floor(Number(req.body?.dueGameDay) || billingDay + 3));
    if (!['cie','sodeci','internet','loyer'].includes(provider) || !/^[a-z0-9_-]{2,32}$/.test(invoiceType) ||
        !Number.isSafeInteger(amount) || amount < 0 || amount > 100000000) {
      return res.status(400).json({ error: 'Données de facture invalides.' });
    }
    try {
      const rows = await supabaseRequest('player_invoices?on_conflict=player_phone,provider,invoice_type,billing_game_day', {
        method: 'POST',
        headers: { Prefer: 'resolution=ignore-duplicates,return=representation' },
        body: JSON.stringify({ player_phone: req.phone, provider, invoice_type: invoiceType,
          amount_fcfa: amount, billing_game_day: billingDay, due_game_day: dueDay })
      });
      res.status(201).json({ ok: true, invoice: rows?.[0] || null });
    } catch (error) {
      console.error('Création facture:', error.message);
      res.status(503).json({ error: 'Facture non enregistrée.' });
    }
  });

  app.post('/api/game/invoices/:id/pay', auth, async (req, res) => {
    if (!requireStorage(res)) return;
    const account = accounts.get(req.phone);
    if (!account) return res.status(404).json({ error: 'Compte introuvable.' });
    const id = safeText(req.params.id, 64);
    try {
      const result = await supabaseRequest('rpc/pay_player_invoice', {
        method: 'POST', body: JSON.stringify({ p_player_phone: req.phone, p_invoice_id: id })
      });
      if (!result?.ok) return res.status(409).json({ error: 'Paiement non confirmé.' });
      account.save = result.save;
      res.json({ ok: true, waveBalance: result.waveBalance, paidAt: result.paidAt });
    } catch (error) {
      const message = String(error.message || '');
      if (message.includes('INSUFFICIENT_WAVE_BALANCE')) return res.status(409).json({ error: 'Solde Wave du jeu insuffisant.' });
      if (message.includes('INVOICE_ALREADY_PAID')) return res.status(409).json({ error: 'Cette facture est déjà payée.' });
      if (message.includes('INVOICE_NOT_FOUND')) return res.status(404).json({ error: 'Facture introuvable.' });
      console.error('Paiement facture:', message);
      res.status(503).json({ error: 'Paiement non confirmé. Aucun débit définitif ne doit être affiché.' });
    }
  });

  app.post('/api/game/devices/equip', auth, async (req, res) => {
    if (!requireStorage(res)) return;
    const deviceId = safeText(req.body?.deviceId, 64);
    const deviceType = safeText(req.body?.deviceType, 24);
    const appearance = req.body?.appearance && typeof req.body.appearance === 'object' ? req.body.appearance : {};
    if (!deviceId || !['phone','computer','tablet'].includes(deviceType) || jsonSize(appearance) > 8000) {
      return res.status(400).json({ error: 'Appareil invalide.' });
    }
    try {
      const rows = await supabaseRequest('player_devices?player_phone=eq.' + encodeURIComponent(req.phone) +
        '&device_id=eq.' + encodeURIComponent(deviceId) + '&select=device_id&limit=1');
      if (!rows?.length) return res.status(403).json({ error: 'Cet appareil ne figure pas dans ton inventaire.' });
      await supabaseRequest('player_devices?player_phone=eq.' + encodeURIComponent(req.phone) +
        '&device_type=eq.' + encodeURIComponent(deviceType), {
        method: 'PATCH', headers: { Prefer: 'return=minimal' },
        body: JSON.stringify({ equipped: false, updated_at: new Date().toISOString() })
      });
      await supabaseRequest('player_devices?player_phone=eq.' + encodeURIComponent(req.phone) +
        '&device_id=eq.' + encodeURIComponent(deviceId), {
        method: 'PATCH', headers: { Prefer: 'return=minimal' },
        body: JSON.stringify({ equipped: true, appearance, updated_at: new Date().toISOString() })
      });
      res.json({ ok: true, deviceId, appearance });
    } catch (error) {
      console.error('Équipement appareil:', error.message);
      res.status(503).json({ error: 'Impossible d’équiper cet appareil.' });
    }
  });
}


  // Durable private conversations. Phone numbers stay server-side; clients address players by unique pseudo.
  const messageRate = new Map();
  app.get('/api/social/messages', auth, async (req, res) => {
    if (!requireStorage(res)) return;
    const phone = encodeURIComponent(req.phone);
    try {
      const [sent, received] = await Promise.all([
        supabaseRequest('player_messages?sender_phone=eq.' + phone + '&select=id,sender_phone,recipient_phone,body,created_at,read_at&order=created_at.desc&limit=100'),
        supabaseRequest('player_messages?recipient_phone=eq.' + phone + '&select=id,sender_phone,recipient_phone,body,created_at,read_at&order=created_at.desc&limit=100')
      ]);
      const now = new Date().toISOString();
      if ((received || []).some(row => !row.read_at)) {
        await supabaseRequest('player_messages?recipient_phone=eq.' + phone + '&read_at=is.null', {
          method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ read_at: now })
        });
      }
      const items = [...(sent || []), ...(received || [])]
        .sort((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at))
        .slice(-150)
        .map(row => {
          const outgoing = row.sender_phone === req.phone;
          const peerPhone = outgoing ? row.recipient_phone : row.sender_phone;
          const peer = accounts.get(peerPhone);
          return {
            id: row.id,
            peerPseudo: safeText(peer?.profile?.pseudo, 24),
            peerName: safeText(peer?.profile?.name, 24) || 'Citoyen',
            direction: outgoing ? 'outgoing' : 'incoming',
            text: row.body,
            createdAt: row.created_at,
            readAt: row.read_at || (!outgoing ? now : null)
          };
        });
      res.set('Cache-Control', 'no-store').json({ ok: true, items });
    } catch (error) {
      console.error('Historique messages privés:', error.message);
      res.status(503).json({ error: 'Historique des messages momentanément indisponible.' });
    }
  });

  app.post('/api/social/messages', auth, async (req, res) => {
    if (!requireStorage(res)) return;
    const pseudo = safeText(req.body?.toPseudo, 24).replace(/^@/, '').toLowerCase();
    const body = safeText(req.body?.text, 500);
    if (!/^[a-z0-9_.-]{3,24}$/i.test(pseudo) || !body) {
      return res.status(400).json({ error: 'Destinataire ou message invalide.' });
    }
    const now = Date.now();
    const recent = (messageRate.get(req.phone) || []).filter(ts => now - ts < 60000);
    if (recent.length >= 20) return res.status(429).json({ error: 'Tu envoies trop de messages. Réessaie dans une minute.' });
    const recipient = [...accounts.values()].find(account =>
      String(account.profile?.pseudo || '').toLowerCase() === pseudo
    );
    if (!recipient) return res.status(404).json({ error: 'Ce pseudo ne correspond à aucun joueur.' });
    if (recipient.phone === req.phone) return res.status(400).json({ error: 'Tu ne peux pas t’envoyer un message.' });
    try {
      const rows = await supabaseRequest('player_messages', {
        method: 'POST',
        headers: { Prefer: 'return=representation' },
        body: JSON.stringify([{
          sender_phone: req.phone,
          recipient_phone: recipient.phone,
          body,
          created_at: new Date(now).toISOString()
        }])
      });
      const saved = rows?.[0];
      if (!saved?.id) throw new Error('Message non confirmé par la base de données.');
      recent.push(now);
      messageRate.set(req.phone, recent);
      res.status(201).json({
        ok: true,
        message: {
          id: saved.id,
          peerPseudo: safeText(recipient.profile?.pseudo, 24),
          peerName: safeText(recipient.profile?.name, 24) || 'Citoyen',
          direction: 'outgoing',
          text: saved.body,
          createdAt: saved.created_at,
          readAt: null
        }
      });
    } catch (error) {
      console.error('Enregistrement message privé:', error.message);
      res.status(503).json({ error: 'Le message n’a pas été enregistré. Réessaie.' });
    }
  });

module.exports = { registerPlayerSystems };
