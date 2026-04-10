const fs = require('fs');
const config = require('../config');

function nowIso() {
  return new Date().toISOString();
}

function safeArraySummary(values) {
  const list = Array.isArray(values) ? values : [];
  return {
    len: list.length,
    nonZero: list.filter((value) => Number(value || 0) !== 0).length,
    sample: list.slice(0, 6)
  };
}

function compactRecipe(recipe) {
  if (!recipe || typeof recipe !== 'object') return null;
  return {
    c: recipe.c,
    n: recipe.n,
    q: recipe.q,
    hash: recipe.hash,
    p: safeArraySummary(recipe.p),
    vu: safeArraySummary(recipe.vu),
    eu: safeArraySummary(recipe.eu),
    ut: safeArraySummary(recipe.ut)
  };
}

function compactCar(car) {
  if (!car || typeof car !== 'object') return null;
  return {
    id: car.id,
    _id: car._id,
    uid: car.uid || car.userId,
    carId: car.carId,
    q: car.q,
    e: car.e,
    recipe: compactRecipe(car.r)
  };
}

function compactProfile(profile) {
  if (!profile || typeof profile !== 'object') return null;
  return {
    uid: profile.uid || profile.id || profile.userId,
    name: profile.name || profile.Nickname,
    currentVehicleTag: profile.CurrentVehicleTag,
    ownedVehicles: Array.isArray(profile.OwnedVehicles) ? profile.OwnedVehicles.slice() : [],
    rank: profile.Rank,
    fuel: profile.Fuel,
    coins: profile.NoCoins,
    stars: profile.NoStars,
    xp: profile.XP,
    active_recipe: profile.active_recipe
  };
}

function compactRace(race) {
  if (!race || typeof race !== 'object') return null;
  return {
    ri: race.ri,
    rc: race.rc,
    rt: race.rt,
    sn: race.sn,
    sv: race.sv,
    oc: race.oc,
    on: race.on,
    pr: race.pr,
    opi: race.opi
  };
}

function appendDebugLine(entry) {
  const line = `${JSON.stringify(entry)}\n`;
  fs.appendFile(config.ff7DebugLogFile, line, (error) => {
    if (error) {
      console.warn(`[FF7 DEBUG] failed to append: ${error.message}`);
    }
  });
}

function logFf7Debug(event, payload) {
  const entry = {
    ts: nowIso(),
    event,
    ...(payload || {})
  };
  console.log(`[FF7 DEBUG] ${event} ${JSON.stringify(payload || {})}`);
  appendDebugLine(entry);
}

module.exports = {
  compactCar,
  compactProfile,
  compactRace,
  compactRecipe,
  logFf7Debug
};
