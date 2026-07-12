// ════════════════════════════════════════════
//  SHARED HELPERS  —  functions/api/_lib.js
//  One home for the boilerplate every Pages Function used to copy:
//  the JSON response helper, CORS headers, and Notion API constants/
//  headers. Import what you need:
//      import { json, notionHdrs, NOTION_API, CORS } from './_lib.js';
//
//  · This file exports no onRequest* handler, so Pages mounts no route
//    for it — it exists only to be imported.
//  · CORS preflight (OPTIONS) is answered centrally by
//    functions/api/_middleware.js; endpoint handlers never see it.
//  · The middleware also replaces these permissive CORS values on every
//    response with the tightened allowed-origin set — the values here
//    are a fallback, not the real policy. Change policy in the
//    middleware, not here.
// ════════════════════════════════════════════

export const NOTION_API = 'https://api.notion.com/v1';
export const NOTION_VER = '2022-06-28';

export const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Methods': 'GET, POST, PATCH, PUT, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

export function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  });
}

export function notionHdrs(token) {
  return {
    'Authorization':  'Bearer ' + token,
    'Notion-Version': NOTION_VER,
    'Content-Type':   'application/json',
  };
}

// Caller-supplied page IDs get interpolated into Notion API URL paths, so
// they must be genuine Notion IDs (32 hex, hyphenated or not) — never a
// value that could steer the request to a different path.
export function isNotionId(id) {
  return typeof id === 'string' && /^[0-9a-fA-F]{32}$/.test(id.replace(/-/g, ''));
}
