const fs   = require('fs');
const path = require('path');
const http = require('http');
const url  = require('url');
const config = require('./config');
const { store } = require('./store');
const { sendJson, sendText, sendNoContent } = require('./lib/http');
const { parseBody, mergeRequestData, getUserId, normalizeMethod } = require('./lib/request');
const { handleBridgeMethod } = require('./handlers/bridgeHandler');
const { buildPlaceholderSvg } = require('./services/mediaService');
const { handleGameFunction, handleRunQueue, handleGetServerStatus, getPackManifestText } = require('./services/gameService');
const { isUnityApiPath, handleUnityApiRequest } = require('./services/unityApiService');
const { isWskeApiPath, handleWskeApiRequest } = require('./services/wskeApiService');
const { isLegacyAuthPath, handleLegacyAuthRequest } = require('./services/authService');
const { isSparxApiPath, handleSparxApiRequest } = require('./services/sparxApiService');

function nowTs() {
  return Math.floor(Date.now() / 1000);
}

function appendRequestLog(entry) {
  const line = `[${new Date().toISOString()}] ${entry}\n`;
  fs.appendFile(config.requestLogFile, line, (error) => {
    if (error) {
      console.warn(`[REQUEST LOG] failed to append: ${error.message}`);
    }
  });
}

function truncateText(value, maxLength = 400) {
  const text = String(value == null ? '' : value);
  return text.length > maxLength ? `${text.slice(0, maxLength)}...<truncated>` : text;
}

function summarizeForLog(value, maxLength = 400) {
  if (value == null) return value;

  if (Array.isArray(value)) {
    return {
      type: 'array',
      length: value.length,
      sample: value.slice(0, 3).map((entry) => summarizeForLog(entry, Math.min(maxLength, 120)))
    };
  }

  if (typeof value === 'string') {
    return truncateText(value, maxLength);
  }

  if (typeof value !== 'object') {
    return value;
  }

  const summary = {};
  Object.keys(value).forEach((key) => {
    if (key === 'screen') {
      summary.screen = '[omitted-base64-screen]';
      return;
    }

    if (key === 'log' && Array.isArray(value.log)) {
      summary.log = {
        length: value.log.length,
        tail: value.log.slice(-5).map((entry) => truncateText(entry, 180))
      };
      return;
    }

    if (key === 'stack' || key === 'condition') {
      summary[key] = truncateText(value[key], 500);
      return;
    }

    if (typeof value[key] === 'string') {
      summary[key] = truncateText(value[key], 180);
      return;
    }

    if (Array.isArray(value[key])) {
      summary[key] = {
        type: 'array',
        length: value[key].length
      };
      return;
    }

    summary[key] = value[key];
  });

  return summary;
}

function appendJsonLine(filePath, payload) {
  fs.appendFile(filePath, `${JSON.stringify(payload)}\n`, (error) => {
    if (error) {
      console.warn(`[APPEND JSON] failed for ${filePath}: ${error.message}`);
    }
  });
}

async function requestHandler(req, res) {
  const parsedUrl = url.parse(req.url, true);
  const pathname = parsedUrl.pathname || '/';
  console.log(`[HTTP] ${req.method} ${pathname}`);
  appendRequestLog(`REQUEST ${req.method} ${pathname}${parsedUrl.search || ''}`);

  if (req.method === 'OPTIONS') {
    return sendNoContent(res);
  }

  if (pathname === '/health') {
    return sendJson(res, 200, { ok: true, ts: nowTs() });
  }

  if (pathname === '/status') {
    return sendJson(res, 200, handleGetServerStatus());
  }

  if (pathname.startsWith('/media/')) {
    const assetName = pathname.split('/').pop().replace(/\.(png|jpg|jpeg|svg)$/i, '');
    // Try real PNG from extracted OBB assets first (profile_pic_* etc.)
    if (/^profile_pic_/i.test(assetName)) {
      const hdPath = path.join(config.dataDir, 'media', 'profilepics', `${assetName}_HD.png`);
      const sdPath = path.join(config.dataDir, 'media', 'profilepics', `${assetName}_SD.png`);
      const pngPath = fs.existsSync(hdPath) ? hdPath : (fs.existsSync(sdPath) ? sdPath : null);
      if (pngPath) {
        const pngData = fs.readFileSync(pngPath);
        res.writeHead(200, { 'Content-Type': 'image/png', 'Content-Length': pngData.length, 'Cache-Control': 'public, max-age=86400' });
        return res.end(pngData);
      }
    }
    return sendText(res, 200, buildPlaceholderSvg(assetName), 'image/svg+xml; charset=utf-8');
  }

  // CDN asset paths: client uses cdn base URL + bundle path to download textures.
  // Support both:
  //  - /global/Bundles/UITextures/...
  //  - /Bundles/UITextures/...
  //  - /global/Bundles/Atlases/...   (atlas prefabs load via this path when OBB lookup fails)
  //  - /Bundles/Atlases/...
  // and both profile folder spellings used by FF7 payloads:
  //  - ProfilePictures
  //  - ProfilePics
  const uiTexturePrefix =
    pathname.startsWith('/global/Bundles/UITextures/')
      ? '/global/Bundles/UITextures/'
      : pathname.startsWith('/Bundles/UITextures/')
        ? '/Bundles/UITextures/'
        : pathname.startsWith('/global/Bundles/Atlases/')
          ? '/global/Bundles/Atlases/'
          : pathname.startsWith('/Bundles/Atlases/')
            ? '/Bundles/Atlases/'
            : '';

  if (uiTexturePrefix) {
    const relativePath = pathname.slice(uiTexturePrefix.length); // e.g. Dialog/enter_name_img_HD.jpg
    const segments = relativePath.split('/').filter(Boolean);
    const category = String(segments[0] || '');
    const filename = String(segments[segments.length - 1] || '');
    const normalizedCategory = category.toLowerCase();
    const requestedExt = path.extname(filename).toLowerCase();
    const bareName = filename
      .replace(/\.(png|jpg|jpeg)$/i, '')
      .replace(/_(HD|SD)$/i, '');

    const atlasAliasMap = {
      streamedhduiatlasprefab: 'HdUiAtlas.png',
      streamedsduiatlasprefab: 'SdUiAtlas.png',
      streamedingamehduiatlasprefab: 'InGameHdUiAtlas.png',
      streamedingamesduiatlasprefab: 'InGameSdUiAtlas.png',
      hudatlasprefab: 'HudAtlas.png'
    };

    const configuredUiTextureRoots = [
      path.join(config.dataDir, 'media', 'UITextures'),
      path.join(config.dataDir, 'media', 'uitextures')
    ];
    const uiTextureRoots = configuredUiTextureRoots.filter((root, index) => (
      configuredUiTextureRoots.indexOf(root) === index && fs.existsSync(root)
    ));
    const effectiveUiTextureRoots = uiTextureRoots.length > 0
      ? uiTextureRoots
      : [configuredUiTextureRoots[0]];
    const configuredProfilePicRoots = [
      path.join(config.dataDir, 'media', 'profilepics'),
      path.join(config.dataDir, 'media', 'ProfilePics'),
      ...effectiveUiTextureRoots.map((root) => path.join(root, 'ProfilePictures')),
      ...effectiveUiTextureRoots.map((root) => path.join(root, 'ProfilePics'))
    ];
    const profilePicRoots = configuredProfilePicRoots.filter((root, index) => (
      configuredProfilePicRoots.indexOf(root) === index
    ));
    const categoryRoots = (
      normalizedCategory === 'profilepictures' || normalizedCategory === 'profilepics'
    )
      ? profilePicRoots
      : effectiveUiTextureRoots.map((root) => path.join(root, category));
    const directPathRoots = effectiveUiTextureRoots.map((root) => path.join(root, ...segments.slice(0, -1)));

    const candidates = [];
    const pushCandidate = (candidatePath) => {
      if (candidatePath && !candidates.includes(candidatePath)) {
        candidates.push(candidatePath);
      }
    };
    const pushCandidatesForRoots = (roots, candidateName) => {
      roots.forEach((root) => {
        pushCandidate(path.join(root, candidateName));
      });
    };

    // 1) Exact filename
    // Prefer the full path under UITextures so nested folders work:
    // /global/Bundles/UITextures/TopBar/Sub/file.png -> data/media/uitextures/TopBar/Sub/file.png
    effectiveUiTextureRoots.forEach((root) => {
      pushCandidate(path.join(root, ...segments));
    });
    // Backward-compatible fallback for category-only layout
    pushCandidatesForRoots(categoryRoots, filename);

    // Atlas prefab aliases used by FF7 client (verified from runtime logs)
    // Atlas prefab aliases used by FF7 client (verified from runtime logs).
    // Handles two URL shapes:
    //   /global/Bundles/UITextures/Atlases/StreamedHdUiAtlasPrefab  -> category='Atlases', filename='StreamedHdUiAtlasPrefab'
    //   /global/Bundles/Atlases/StreamedHdUiAtlasPrefab             -> single segment, normalizedCategory IS the atlas key
    const isAtlasCategory = normalizedCategory === 'atlases';
    const isAtlasSingleSegment = !isAtlasCategory && Boolean(atlasAliasMap[normalizedCategory]);
    if (isAtlasCategory || isAtlasSingleSegment) {
      const lookupKey = isAtlasSingleSegment ? normalizedCategory : String(bareName).toLowerCase();
      const atlasAlias = atlasAliasMap[lookupKey];
      if (atlasAlias) {
        // For single-segment paths category roots point at a nonexistent dir; use shared atlas dir roots.
        const atlasRoots = isAtlasSingleSegment
          ? effectiveUiTextureRoots.map((root) => path.join(root, 'Atlases'))
          : categoryRoots;
        pushCandidatesForRoots(atlasRoots, atlasAlias);
      }
    }

    // 2) Size/ext fallbacks
    if (!requestedExt) {
      pushCandidatesForRoots(directPathRoots, `${bareName}_HD.png`);
      pushCandidatesForRoots(directPathRoots, `${bareName}_SD.png`);
      pushCandidatesForRoots(directPathRoots, `${bareName}_HD.jpg`);
      pushCandidatesForRoots(directPathRoots, `${bareName}_SD.jpg`);
      pushCandidatesForRoots(directPathRoots, `${bareName}.png`);
      pushCandidatesForRoots(directPathRoots, `${bareName}.jpg`);
      pushCandidatesForRoots(categoryRoots, `${bareName}_HD.png`);
      pushCandidatesForRoots(categoryRoots, `${bareName}_SD.png`);
      pushCandidatesForRoots(categoryRoots, `${bareName}_HD.jpg`);
      pushCandidatesForRoots(categoryRoots, `${bareName}_SD.jpg`);
      pushCandidatesForRoots(categoryRoots, `${bareName}.png`);
      pushCandidatesForRoots(categoryRoots, `${bareName}.jpg`);
    } else {
      pushCandidatesForRoots(directPathRoots, `${bareName}_HD${requestedExt}`);
      pushCandidatesForRoots(directPathRoots, `${bareName}_SD${requestedExt}`);
      if (requestedExt === '.png') {
        pushCandidatesForRoots(directPathRoots, `${bareName}_HD.jpg`);
        pushCandidatesForRoots(directPathRoots, `${bareName}_SD.jpg`);
        pushCandidatesForRoots(directPathRoots, `${bareName}.jpg`);
      }
      if (requestedExt === '.jpg' || requestedExt === '.jpeg') {
        pushCandidatesForRoots(directPathRoots, `${bareName}_HD.png`);
        pushCandidatesForRoots(directPathRoots, `${bareName}_SD.png`);
        pushCandidatesForRoots(directPathRoots, `${bareName}.png`);
      }
      pushCandidatesForRoots(categoryRoots, `${bareName}_HD${requestedExt}`);
      pushCandidatesForRoots(categoryRoots, `${bareName}_SD${requestedExt}`);
      if (requestedExt === '.png') {
        pushCandidatesForRoots(categoryRoots, `${bareName}_HD.jpg`);
        pushCandidatesForRoots(categoryRoots, `${bareName}_SD.jpg`);
        pushCandidatesForRoots(categoryRoots, `${bareName}.jpg`);
      }
      if (requestedExt === '.jpg' || requestedExt === '.jpeg') {
        pushCandidatesForRoots(categoryRoots, `${bareName}_HD.png`);
        pushCandidatesForRoots(categoryRoots, `${bareName}_SD.png`);
        pushCandidatesForRoots(categoryRoots, `${bareName}.png`);
      }
    }

    for (const candidate of candidates) {
      if (!fs.existsSync(candidate)) continue;
      const data = fs.readFileSync(candidate);
      const ext = path.extname(candidate).toLowerCase();
      const contentType = (ext === '.jpg' || ext === '.jpeg') ? 'image/jpeg' : 'image/png';
      res.writeHead(200, {
        'Content-Type': contentType,
        'Content-Length': data.length,
        'Cache-Control': 'public, max-age=86400'
      });
      return res.end(data);
    }

    // For atlas prefab requests return a minimal 1×1 transparent PNG stub.
    // Unity's asset loader cannot parse SVG and returns null, which propagates
    // as a NullReferenceException in XPWidget.Refresh() -> XPWidget.SetData().
    if (isAtlasCategory || isAtlasSingleSegment) {
      // Smallest valid PNG: 1×1 transparent pixel (68 bytes)
      const TRANSPARENT_1X1_PNG = Buffer.from(
        '89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000a49444154789c6260000000020001e221bc330000000049454e44ae426082',
        'hex'
      );
      res.writeHead(200, {
        'Content-Type': 'image/png',
        'Content-Length': TRANSPARENT_1X1_PNG.length,
        'Cache-Control': 'no-store'
      });
      return res.end(TRANSPARENT_1X1_PNG);
    }

    return sendText(res, 200, buildPlaceholderSvg(bareName || filename || 'texture'), 'image/svg+xml; charset=utf-8');
  }



  if (pathname === '/packs.txt') {
    return sendText(res, 200, getPackManifestText(), 'application/json; charset=utf-8');
  }

  if (pathname === '/bugs') {
    const body = await parseBody(req);
    console.log(`[BUGS API] ${req.method} ${pathname} ${JSON.stringify(summarizeForLog(body, 240))}`);
    appendJsonLine(config.bugsFile, {
      timestamp: new Date().toISOString(),
      body
    });
    return sendJson(res, 200, { ok: true, stored: true, ts: nowTs() });
  }

  if (pathname === '/telemetry') {
    const body = req.method === 'GET' ? {} : await parseBody(req);
    const events = Array.isArray(body.events) ? body.events : [];
    console.log(`[TELEMETRY API] ${req.method} ${pathname} ${JSON.stringify(summarizeForLog(body, 240))}`);
    return sendJson(res, 200, {
      ts: nowTs(),
      err: null,
      error: null,
      success: true,
      successful: true,
      sucessful: true,
      accepted: true,
      eventCount: events.length,
      result: {
        accepted: true,
        eventCount: events.length,
        eventsAccepted: true
      }
    });
  }

  if (pathname === '/util/ping') {
    const body = req.method === 'GET' ? {} : await parseBody(req);
    console.log(`[UTIL API] ${req.method} ${pathname} ${JSON.stringify(summarizeForLog(body, 200))}`);
    return sendJson(res, 200, {
      ts: nowTs(),
      err: null,
      error: null,
      success: true,
      successful: true,
      sucessful: true,
      result: {
        pong: true,
        accepted: true
      }
    });
  }

  if (isLegacyAuthPath(pathname)) {
    const body = req.method === 'GET' ? {} : await parseBody(req);
    const params = mergeRequestData(body, parsedUrl);
    console.log(`[AUTH API] ${req.method} ${pathname} ${JSON.stringify(summarizeForLog(params, 220))}`);
    const result = handleLegacyAuthRequest(pathname, params);
    if (result) {
      return sendJson(res, result.statusCode || 200, result.payload);
    }
  }

  if (isWskeApiPath(pathname)) {
    const body = req.method === 'GET' ? {} : await parseBody(req);
    const params = mergeRequestData(body, parsedUrl);
    console.log(`[WSKE API] ${req.method} ${pathname} ${JSON.stringify(summarizeForLog(params, 220))}`);
    const result = handleWskeApiRequest(pathname, req.method, params, req.headers || {});
    if (result) {
      return sendJson(res, result.statusCode || 200, result.payload);
    }
  }

  if (isUnityApiPath(pathname)) {
    const body = req.method === 'GET' ? {} : await parseBody(req);
    const params = mergeRequestData(body, parsedUrl);
    const userId = getUserId(params, parsedUrl);
    console.log(`[UNITY API] ${req.method} ${pathname} ${JSON.stringify(summarizeForLog(params, 220))}`);
    const result = handleUnityApiRequest(pathname, params, userId);
    if (result) {
      return sendJson(res, result.statusCode || 200, result.payload);
    }
  }

  if (isSparxApiPath(pathname)) {
    const body = req.method === 'GET' ? {} : await parseBody(req);
    const params = mergeRequestData(body, parsedUrl);
    const userId = getUserId(params, parsedUrl);
    console.log(`[SPARX API] ${req.method} ${pathname} ${JSON.stringify(summarizeForLog(params, 220))}`);
    const result = handleSparxApiRequest(pathname, req.method, params, userId);
    if (result) {
      return sendJson(res, result.statusCode || 200, result.payload);
    }
  }

  if (pathname === '/bridge/server-data' || pathname === '/bridge/article-data') {
    const body = await parseBody(req);
    const methodInfo = normalizeMethod(body, parsedUrl);
    const userId = getUserId(body, parsedUrl);
    return sendJson(res, 200, handleBridgeMethod(methodInfo, userId));
  }

  if (pathname === '/bridge/game-function') {
    const body = await parseBody(req);
    const userId = getUserId(body, parsedUrl);
    return sendJson(res, 200, handleGameFunction(body.funcName, body.options, userId));
  }

  if (pathname === '/bridge/runqueue') {
    const body = await parseBody(req);
    const userId = getUserId(body, parsedUrl);
    return sendJson(res, 200, handleRunQueue(body, userId));
  }

  if (pathname === '/debug/state') {
    return sendJson(res, 200, store.state);
  }

  // ── jsonresponses static fallback (FF6-style) ─────────────────────────────
  // If nothing above handled the request, try serving a static JSON file
  // from the jsonresponses/ directory.  The lookup strips leading slashes and
  // path separators so that e.g. /motd/status maps to motdstatus.json.
  {
    const slug = pathname.replace(/^\/+/, '').replace(/\//g, '') + '.json';
    const candidatePath = path.join(config.jsonResponsesDir, slug);
    if (fs.existsSync(candidatePath)) {
      try {
        const data = fs.readFileSync(candidatePath, 'utf8');
        return sendJson(res, 200, JSON.parse(data));
      } catch (_) {
        // fall through to 404
      }
    }
  }

  return sendJson(res, 404, {
    success: false,
    error: 'NotFound',
    path: pathname
  });
}

function createAppServer() {
  return http.createServer((req, res) => {
    req.socket.setNoDelay(true);
    req.socket.setKeepAlive(true, 30000);
    const RESPONSE_LOG_CAPTURE_LIMIT = 2048;
    const previewChunks = [];
    let previewBytes = 0;
    let totalBytes = 0;
    let statusCode = 200;
    const originalWrite = res.write.bind(res);
    const originalEnd = res.end.bind(res);
    const originalWriteHead = res.writeHead.bind(res);

    function captureChunk(chunk, encoding) {
      if (!chunk) {
        return;
      }

      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk, encoding);
      totalBytes += buffer.length;

      if (previewBytes >= RESPONSE_LOG_CAPTURE_LIMIT) {
        return;
      }

      const remaining = RESPONSE_LOG_CAPTURE_LIMIT - previewBytes;
      if (buffer.length <= remaining) {
        previewChunks.push(buffer);
        previewBytes += buffer.length;
        return;
      }

      previewChunks.push(buffer.subarray(0, remaining));
      previewBytes += remaining;
    }

    res.writeHead = function patchedWriteHead(code) {
      statusCode = code;
      return originalWriteHead.apply(res, arguments);
    };

    res.write = function patchedWrite(chunk, encoding, callback) {
      captureChunk(chunk, encoding);
      return originalWrite(chunk, encoding, callback);
    };

    res.end = function patchedEnd(chunk, encoding, callback) {
      captureChunk(chunk, encoding);

      const previewBody = previewChunks.length > 0 ? Buffer.concat(previewChunks).toString('utf8') : '';
      const preview =
        totalBytes > RESPONSE_LOG_CAPTURE_LIMIT
          ? `${previewBody}...<truncated len=${totalBytes}>`
          : previewBody;
      appendRequestLog(`RESPONSE ${req.method} ${req.url} ${statusCode} ${preview}`);

      return originalEnd(chunk, encoding, callback);
    };

    requestHandler(req, res).catch((error) => {
      sendJson(res, 500, {
        success: false,
        error: 'ServerError',
        message: error.message
      });
    });
  });
}

module.exports = {
  createAppServer
};
