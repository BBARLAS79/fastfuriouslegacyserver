const fs = require('fs');
const path = require('path');

function loadJson(filePath, fallback) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (_) {
    return fallback;
  }
}

function saveJson(filePath, data) {
  const targetDir = path.dirname(filePath);
  const tempPath = path.join(
    targetDir,
    `.${path.basename(filePath)}.${process.pid}.${Date.now()}.tmp`
  );
  const payload = JSON.stringify(data, null, 2);

  fs.writeFileSync(tempPath, payload);
  fs.renameSync(tempPath, filePath);
}

module.exports = {
  loadJson,
  saveJson
};
