'use strict';

const COMMUNES = Object.freeze([
  'Anyama','Abobo','Songon','Yopougon','Attécoubé','Adjamé','Cocody',
  'Bingerville','Le Plateau','Treichville','Marcory','Koumassi','Port-Bouët'
]);

function normalizeBirthDate(value) {
  const raw=String(value||'').trim();
  if(!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return null;
  const date=new Date(raw+'T00:00:00.000Z');
  if(!Number.isFinite(date.getTime()) || date.toISOString().slice(0,10)!==raw) return null;
  const now=new Date();
  const earliest=new Date(Date.UTC(now.getUTCFullYear()-120,now.getUTCMonth(),now.getUTCDate()));
  if(date>new Date(Date.UTC(now.getUTCFullYear(),now.getUTCMonth(),now.getUTCDate())) || date<earliest) return null;
  return raw;
}

function calculateAge(birthDate, now=new Date()) {
  const normalized=normalizeBirthDate(birthDate);
  if(!normalized) return null;
  const birth=new Date(normalized+'T00:00:00.000Z');
  let age=now.getUTCFullYear()-birth.getUTCFullYear();
  const month=now.getUTCMonth()-birth.getUTCMonth();
  if(month<0 || (month===0 && now.getUTCDate()<birth.getUTCDate())) age--;
  return age;
}

function normalizeIdentity(input={}) {
  const birthDate=normalizeBirthDate(input.birthDate);
  const birthPlace=COMMUNES.find(name=>name.toLowerCase()===String(input.birthPlace||'').trim().toLowerCase());
  if(!birthDate || !birthPlace) return null;
  return {birthDate,birthPlace};
}

module.exports={COMMUNES,normalizeBirthDate,calculateAge,normalizeIdentity};
