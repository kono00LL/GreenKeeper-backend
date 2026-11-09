// Reviewed, versioned data; no network access or generated identities at import time.
const original = require('./data/indoor-balcony-v1.json');
const additions = require('./data/indoor-balcony-v2-additions.json');
const newest = require('./data/indoor-balcony-v3-additions.json');
const latest = require('./data/indoor-balcony-v4-additions.json');
const catalog = [...original, ...additions, ...newest, ...latest];
module.exports = { catalog };
