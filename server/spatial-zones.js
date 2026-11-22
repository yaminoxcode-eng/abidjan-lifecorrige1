'use strict';

const MULTIPLAYER_ZONE_SIZE = Math.max(
  100,
  Math.min(5000, Number(process.env.MULTIPLAYER_ZONE_SIZE) || 750)
);

function multiplayerZone(position = {}) {
  const x = Number.isFinite(Number(position.x)) ? Number(position.x) : 0;
  const z = Number.isFinite(Number(position.z)) ? Number(position.z) : 0;
  return `${Math.floor(x / MULTIPLAYER_ZONE_SIZE)}:${Math.floor(z / MULTIPLAYER_ZONE_SIZE)}`;
}

function multiplayerZoneRooms(zone) {
  const parts = String(zone || '0:0').split(':').map(Number);
  const x = Number.isFinite(parts[0]) ? parts[0] : 0;
  const z = Number.isFinite(parts[1]) ? parts[1] : 0;
  const rooms = [];
  for (let dx = -1; dx <= 1; dx++) {
    for (let dz = -1; dz <= 1; dz++) rooms.push(`${x + dx}:${z + dz}`);
  }
  return rooms;
}

module.exports = { MULTIPLAYER_ZONE_SIZE, multiplayerZone, multiplayerZoneRooms };
