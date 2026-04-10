const os = require('os');
const path = require('path');

const ROOT_DIR = path.resolve(__dirname, '..');
const DATA_DIR = path.join(ROOT_DIR, 'data');
const SAVE_DIR = path.join(ROOT_DIR, 'savedata');
const JSON_RESPONSES_DIR = path.join(ROOT_DIR, 'jsonresponses');

function toPort(value, fallback) {
  const parsed = parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function formatHostPort(host, port, defaultPort) {
  return port === defaultPort ? host : `${host}:${port}`;
}

function isPrivateIpv4(address) {
  return (
    address.startsWith('10.') ||
    address.startsWith('192.168.') ||
    /^172\.(1[6-9]|2\d|3[0-1])\./.test(address)
  );
}

function getIpv4Candidates() {
  const interfaces = os.networkInterfaces();
  const candidates = [];

  Object.keys(interfaces).forEach((name) => {
    (interfaces[name] || []).forEach((entry) => {
      if (entry.family !== 'IPv4' || entry.internal) return;
      candidates.push({
        name,
        address: entry.address
      });
    });
  });

  return candidates;
}

function sortCandidates(a, b) {
  function score(candidate) {
    let value = 0;
    if (candidate.name === 'en0') value += 100;
    else if (/^en\d+$/.test(candidate.name)) value += 80;
    else if (/^eth\d+$/.test(candidate.name)) value += 70;

    if (isPrivateIpv4(candidate.address)) value += 20;
    if (candidate.address.startsWith('192.168.')) value += 5;
    return value;
  }

  return score(b) - score(a);
}

function resolvePreferredHost() {
  if (process.env.PUBLIC_HOST) return process.env.PUBLIC_HOST;

  const candidates = getIpv4Candidates().sort(sortCandidates);
  if (candidates.length > 0) {
    return candidates[0].address;
  }

  return '127.0.0.1';
}

const detectedPublicHost = resolvePreferredHost();
const detectedLanHosts = getIpv4Candidates().sort(sortCandidates).map((candidate) => candidate.address);

module.exports = {
  bindHost: process.env.BIND_HOST || process.env.HOST || '0.0.0.0',
  publicHost: detectedPublicHost,
  lanHosts: detectedLanHosts,
  httpPort: toPort(process.env.HTTP_PORT || process.env.PORT || '80', 80),
  httpsPort: toPort(process.env.HTTPS_PORT || '443', 443),
  sslKeyPath: process.env.SSL_KEY_PATH || '',
  sslCertPath: process.env.SSL_CERT_PATH || '',
  rootDir: ROOT_DIR,
  dataDir: DATA_DIR,
  saveDir: SAVE_DIR,
  jsonResponsesDir: JSON_RESPONSES_DIR,
  channelsFile: path.join(DATA_DIR, 'channels.json'),
  articlesFile: path.join(DATA_DIR, 'articles.json'),
  stateFile: path.join(DATA_DIR, 'user-state.json'),
  crewsFile: path.join(DATA_DIR, 'crews.json'),
  bugsFile: path.join(DATA_DIR, 'bugs.json'),
  requestLogFile: path.join(DATA_DIR, 'requests.log'),
  ff7DebugLogFile: path.join(DATA_DIR, 'ff7-debug.log'),
  getPublicHttpAddress() {
    return formatHostPort(this.publicHost, this.httpPort, 80);
  },
  getPublicHttpsAddress() {
    return formatHostPort(this.publicHost, this.httpsPort, 443);
  }
};
