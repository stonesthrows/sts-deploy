export async function onRequestGet(context) {
  const hasToken = !!context.env.SQUARE_TOKEN;
  const tokenPrefix = hasToken ? context.env.SQUARE_TOKEN.slice(0, 8) + '…' : null;
  return new Response(JSON.stringify({ hasToken, tokenPrefix }), {
    headers: { 'Content-Type': 'application/json' },
  });
}
