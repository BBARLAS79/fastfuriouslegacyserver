function sendJson(res, statusCode, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Access-Control-Allow-Origin': '*',
    'Connection': 'keep-alive',
    'Keep-Alive': 'timeout=60, max=1000'
  });
  res.end(body);
}

function sendText(res, statusCode, body, contentType) {
  res.writeHead(statusCode, {
    'Content-Type': contentType || 'text/plain; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Access-Control-Allow-Origin': '*',
    'Connection': 'keep-alive',
    'Keep-Alive': 'timeout=60, max=1000'
  });
  res.end(body);
}

function sendNoContent(res) {
  res.writeHead(204, {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, X-KBM-AuthToken, X-KBM-Player-Certificate, X-KBM-Token, X-KBM-Client-Id, X-KBM-Signature, X-KBM-Timestamp, X-KBM-Nonce, X-KBM-Device',
    'Connection': 'keep-alive',
    'Keep-Alive': 'timeout=60, max=1000'
  });
  res.end();
}

module.exports = {
  sendJson,
  sendText,
  sendNoContent
};
