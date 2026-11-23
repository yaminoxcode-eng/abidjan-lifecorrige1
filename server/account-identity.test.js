'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {COMMUNES,normalizeBirthDate,calculateAge,normalizeIdentity}=require('./account-identity');

test('communes de naissance limitées aux communes du jeu',()=>{
  assert.equal(COMMUNES.length,13);
  assert.equal(normalizeIdentity({birthDate:'2000-01-01',birthPlace:'Cocody'}).birthPlace,'Cocody');
  assert.equal(normalizeIdentity({birthDate:'2000-01-01',birthPlace:'Paris'}),null);
});

test('date de naissance stricte et valide',()=>{
  assert.equal(normalizeBirthDate('2000-02-29'),'2000-02-29');
  assert.equal(normalizeBirthDate('2001-02-29'),null);
  assert.equal(normalizeBirthDate('2099-01-01'),null);
  assert.equal(normalizeBirthDate('01/01/2000'),null);
});

test('âge calculé selon le jour et le mois, pas seulement l’année',()=>{
  assert.equal(calculateAge('2008-11-22',new Date('2026-11-21T12:00:00Z')),17);
  assert.equal(calculateAge('2008-11-20',new Date('2026-11-21T12:00:00Z')),18);
  assert.equal(calculateAge('2009-12-01',new Date('2026-11-21T12:00:00Z')),16);
});
