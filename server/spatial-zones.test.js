'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { multiplayerZone, multiplayerZoneRooms, MULTIPLAYER_ZONE_SIZE } = require('./spatial-zones');

test('players in the same cell share a zone', () => {
  assert.equal(multiplayerZone({ x: 10, z: 20 }), '0:0');
  assert.equal(multiplayerZone({ x: MULTIPLAYER_ZONE_SIZE - 1, z: 1 }), '0:0');
});

test('zone boundaries use floor and handle negative coordinates', () => {
  assert.equal(multiplayerZone({ x: MULTIPLAYER_ZONE_SIZE, z: 0 }), '1:0');
  assert.equal(multiplayerZone({ x: -1, z: -1 }), '-1:-1');
});

test('each player subscribes to its cell and the eight adjacent cells', () => {
  const rooms = multiplayerZoneRooms('2:-3');
  assert.equal(rooms.length, 9);
  assert.equal(new Set(rooms).size, 9);
  assert.ok(rooms.includes('2:-3'));
  assert.ok(rooms.includes('3:-2'));
  assert.ok(rooms.includes('1:-4'));
});
