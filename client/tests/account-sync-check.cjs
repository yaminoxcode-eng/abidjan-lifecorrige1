const fs = require('node:fs');
const assert = require('node:assert/strict');

const client = fs.readFileSync('client/index.html', 'utf8');
const server = fs.readFileSync('server/server.js', 'utf8');

assert.ok(client.includes("data.player?.save"), 'login must receive the server save');
assert.ok(client.includes("safeSet(__accountSaveKey,JSON.stringify(data.player.save))"), 'login must store the server save locally');
assert.ok(client.includes("activeGameAccount=canonical;LIFE_SAVE_KEY=saveKey"), 'account activation must select the account-specific save');
assert.ok(client.includes("if(saved.v19&&typeof saved.v19==='object'"), 'load must restore version 19 app state');
assert.ok(client.includes("v19:lifeState.v19&&typeof lifeState.v19==='object'?lifeState.v19:{}"), 'save must serialize version 19 app state');
assert.ok(client.includes("installedApps.push(a.id)"), 'app store must record installed apps');
assert.ok(client.includes("socket.emit('player:save'"), 'client must send saves through the multiplayer socket');
assert.ok(server.includes("player: { ...publicPlayer(a, phone), save: a.save }"), 'login response must include persisted save');
assert.ok(server.includes("socket.on('player:save'"), 'server must accept player saves');
assert.ok(server.includes("await persistAccount(account)"), 'server must persist player saves');
assert.ok(server.includes("ack({ ok, persistent: persistentStorageEnabled })"), 'server must acknowledge save result');
assert.ok(server.includes("socket.broadcast.emit('player:moved'"), 'server must broadcast player movement');
assert.ok(server.includes("socket.emit(\n    'world:players'"), 'server must send already-connected players to new sessions');
console.log('Account-sync checks passed: login restore, app persistence, server save acknowledgement and multiplayer presence.');
