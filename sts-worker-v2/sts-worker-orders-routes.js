/**
 * STS Orders — Kanban routes for sts-worker-v2
 * =============================================
 * Paste these routes into your existing worker (or import as a module).
 *
 * SETUP (one-time):
 *   1. Create the KV namespace:
 *        wrangler kv namespace create STS_ORDERS
 *   2. Add the binding to wrangler.toml:
 *        [[kv_namespaces]]
 *        binding = "STS_ORDERS"
 *        id = "<id from step 1>"
 *   3. (Later, for Notion write-behind) set NOTION_ORDERS_DB_ID below and make
 *      sure your existing NOTION_TOKEN secret is available.
 *
 * STORAGE MODEL:
 *   All orders live under a single KV key ("orders:v1") as a JSON array.
 *   At your volume (<100 active orders) this is faster and simpler than
 *   per-order keys, and it makes GET /orders a single read.
 *
 * ENDPOINTS:
 *   GET    /orders        → full order list
 *   POST   /orders        → create (body = order JSON)
 *   PATCH  /orders/:id    → update (body = full or partial order JSON)
 *   DELETE /orders/:id    → remove
 */

const ORDERS_KEY = 'orders:v1';
const NOTION_ORDERS_DB_ID = ''; // ← fill in when ready for Notion write-behind

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,POST,PATCH,DELETE,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...CORS },
  });

/**
 * Call this from your worker's fetch handler, e.g.:
 *
 *   const ordersResponse = await handleOrders(request, env, ctx);
 *   if (ordersResponse) return ordersResponse;
 *
 * Returns a Response for /orders* paths, or null so your other routes run.
 */
export async function handleOrders(request, env, ctx) {
  const url = new URL(request.url);
  if (!url.pathname.startsWith('/orders')) return null;

  if (request.method === 'OPTIONS') return new Response(null, { headers: CORS });

  const idMatch = url.pathname.match(/^\/orders\/([^/]+)$/);
  const id = idMatch ? decodeURIComponent(idMatch[1]) : null;

  const readAll = async () =>
    (await env.STS_ORDERS.get(ORDERS_KEY, 'json')) || [];
  const writeAll = (orders) =>
    env.STS_ORDERS.put(ORDERS_KEY, JSON.stringify(orders));

  // ---- GET /orders ----------------------------------------------------
  if (request.method === 'GET' && url.pathname === '/orders') {
    return json(await readAll());
  }

  // ---- POST /orders ---------------------------------------------------
  if (request.method === 'POST' && url.pathname === '/orders') {
    const order = await request.json();
    if (!order.id) order.id = 'o' + Date.now().toString(36);
    order.createdAt ??= Date.now();
    order.updatedAt = Date.now();

    const orders = await readAll();
    orders.push(order);
    await writeAll(orders);

    ctx.waitUntil(pushToNotion(order, env)); // fire-and-forget
    return json(order, 201);
  }

  // ---- PATCH /orders/:id ----------------------------------------------
  if (request.method === 'PATCH' && id) {
    const patch = await request.json();
    const orders = await readAll();
    const idx = orders.findIndex((o) => o.id === id);
    if (idx === -1) return json({ error: 'Order not found' }, 404);

    orders[idx] = { ...orders[idx], ...patch, id, updatedAt: Date.now() };
    await writeAll(orders);

    ctx.waitUntil(pushToNotion(orders[idx], env));
    return json(orders[idx]);
  }

  // ---- DELETE /orders/:id ---------------------------------------------
  if (request.method === 'DELETE' && id) {
    const orders = await readAll();
    const next = orders.filter((o) => o.id !== id);
    if (next.length === orders.length) return json({ error: 'Order not found' }, 404);
    await writeAll(next);
    return json({ deleted: id });
  }

  return json({ error: 'Unsupported orders route' }, 405);
}

/**
 * Notion write-behind (no-op until NOTION_ORDERS_DB_ID is set).
 *
 * Strategy: KV is the live board; Notion is the durable record. Each
 * create/update mirrors the order into a Notion database page keyed by
 * the order id, so the board never waits on Notion's latency.
 *
 * Adjust the property names below to match your Notion orders database
 * schema before enabling.
 */
async function pushToNotion(order, env) {
  if (!NOTION_ORDERS_DB_ID || !env.NOTION_TOKEN) return;
  try {
    const headers = {
      Authorization: `Bearer ${env.NOTION_TOKEN}`,
      'Notion-Version': '2022-06-28',
      'Content-Type': 'application/json',
    };

    // Find existing page for this order id
    const q = await fetch(
      `https://api.notion.com/v1/databases/${NOTION_ORDERS_DB_ID}/query`,
      {
        method: 'POST',
        headers,
        body: JSON.stringify({
          filter: { property: 'Order ID', rich_text: { equals: order.id } },
          page_size: 1,
        }),
      }
    ).then((r) => r.json());

    const props = {
      Name:       { title: [{ text: { content: order.customer || 'Unnamed' } }] },
      'Order ID': { rich_text: [{ text: { content: order.id } }] },
      Type:       { select: { name: order.type || 'custom' } },
      Stage:      { select: { name: order.subStage || '' } },
      Column:     { select: { name: order.column || '' } },
      Location:   { select: { name: order.location || 'Studio' } },
      Payment:    { select: { name: order.payment || 'unpaid' } },
      Assignee:   { select: { name: order.assignee || 'Kyle' } },
      Status:     { select: { name: order.status || 'active' } },
      ...(order.deadline ? { Deadline: { date: { start: order.deadline } } } : {}),
    };

    if (q.results?.length) {
      await fetch(`https://api.notion.com/v1/pages/${q.results[0].id}`, {
        method: 'PATCH',
        headers,
        body: JSON.stringify({ properties: props }),
      });
    } else {
      await fetch('https://api.notion.com/v1/pages', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          parent: { database_id: NOTION_ORDERS_DB_ID },
          properties: props,
        }),
      });
    }
  } catch (e) {
    // Write-behind must never break the board; log and move on.
    console.error('Notion write-behind failed:', e);
  }
}
