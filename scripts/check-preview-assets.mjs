import { setTimeout as pause } from 'node:timers/promises';
import { pathToFileURL } from 'node:url';

const TARGET = 'http://127.0.0.1:4173/';
const READINESS_TIMEOUT_MS = 60_000;
const REQUEST_TIMEOUT_MS = 1_000;

function initialAssets(html) {
  const assets = [];
  // Only the initial generated HTML is inspected, not a recursive asset graph.
  const tags = html.replace(/<!--[\s\S]*?-->/g, '').match(/<(?:script|link)\b[^>]*>/gi) ?? [];
  for (const tag of tags) {
    const attributes = Object.fromEntries(
      [...tag.matchAll(/([\w-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g)].map(
        ([, key, doubleQuoted, singleQuoted, unquoted]) => [
          key.toLowerCase(),
          doubleQuoted ?? singleQuoted ?? unquoted,
        ],
      ),
    );
    if (/^<script\b/i.test(tag) && attributes.type === 'module' && attributes.src) {
      assets.push({ path: attributes.src, kind: 'module' });
    }
    if (/^<link\b/i.test(tag) && attributes.href) {
      if (attributes.rel === 'stylesheet') {
        assets.push({ path: attributes.href, kind: 'stylesheet' });
      } else if (attributes.rel === 'modulepreload') {
        assets.push({ path: attributes.href, kind: 'preload' });
      }
    }
  }
  if (
    !assets.some(({ kind }) => kind === 'module') ||
    !assets.some(({ kind }) => kind === 'stylesheet')
  ) {
    throw new Error('HTML must link an initial module and stylesheet');
  }
  return assets.map(({ path, kind }) => {
    const url = new URL(path, TARGET);
    if (url.origin !== new URL(TARGET).origin) {
      throw new Error('initial assets must use the same origin as the preview');
    }
    return { url: url.href, kind };
  });
}

async function readResponse(url, fetchImpl, timeoutMs) {
  const controller = new AbortController();
  let timer;
  try {
    return await Promise.race([
      (async () => {
        const response = await fetchImpl(url, { signal: controller.signal, redirect: 'error' });
        const body = await response.text();
        return { status: response.status, type: response.headers.get('content-type') ?? '', body };
      })(),
      new Promise((_, reject) => {
        timer = setTimeout(() => {
          controller.abort();
          reject(new Error('request or response body timed out'));
        }, timeoutMs);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

async function checkInitialAssets(fetchImpl, remainingMs) {
  const get = (url) => readResponse(url, fetchImpl, Math.min(REQUEST_TIMEOUT_MS, remainingMs()));
  const html = await get(TARGET);
  if (html.status !== 200 || !/^text\/html(?:;|$)/i.test(html.type)) {
    throw new Error('preview HTML must return 200 with text/html');
  }
  if (!/<div\b[^>]*\bid=["']root["']/.test(html.body)) {
    throw new Error('preview HTML is missing the app root');
  }
  const assets = initialAssets(html.body);
  for (const { url, kind } of assets) {
    const { status, type, body } = await get(url);
    const expectedType =
      kind === 'stylesheet'
        ? /^text\/css(?:;|$)/i
        : /^(?:text|application)\/(?:javascript|ecmascript)(?:;|$)/i;
    if (
      status !== 200 ||
      !expectedType.test(type) ||
      !body.trim() ||
      /<(?:!doctype|html|head|body)\b/i.test(body)
    ) {
      throw new Error(
        `initial ${kind} asset ${new URL(url).pathname} is not usable (${status}, ${type})`,
      );
    }
  }
  return assets;
}

export async function waitForPreviewAssets({
  fetchImpl = fetch,
  timeoutMs = READINESS_TIMEOUT_MS,
  now = Date.now,
  pause: wait = pause,
} = {}) {
  const deadline = now() + timeoutMs;
  const remainingMs = () => {
    const remaining = deadline - now();
    if (remaining <= 0) throw new Error('readiness deadline reached');
    return remaining;
  };
  let lastError;
  while (now() < deadline) {
    try {
      return await checkInitialAssets(fetchImpl, remainingMs);
    } catch (error) {
      lastError = error;
      await wait(Math.max(0, Math.min(1_000, deadline - now())));
    }
  }
  throw new Error(
    `Preview not ready within ${timeoutMs}ms: ${lastError?.message ?? 'deadline reached'}`,
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const assets = await waitForPreviewAssets();
    console.log(`Preview HTML and ${assets.length} initial module/style assets are ready.`);
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
