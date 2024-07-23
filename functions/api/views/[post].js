function parseRequestCookie(req) {
  let cookieObj = {};
  let tokens, cookie;

  if (!req.headers.has('cookie'))
    return null;

  cookie = req.headers.get('cookie');
  tokens = cookie.split(/=|;/);

  if ((tokens.length % 2) !== 0) {
    console.warn(`Token length not even: ${tokens.length}`);
  }

  for (let i = 0; i < (tokens.length / 2); i++) {
    cookieObj[tokens[(i * 2)].trim()] = JSON.parse(tokens[(i * 2) + 1].trim());
  }

  return cookieObj;
}

export async function onRequestGet(ctx) {
  const env = ctx.env;
  const post = ctx.params.post;
  try {
    const count = await env.BLOG.PAGE_VIEWS.get(`${post}`);
    if (count === null) {
      return new Response(null, {status: 404, statusText: "count not found"});
    }
    return new Response(Number(count), {status: 200});
  } catch (e) {
    return new Response(null, {status: 500, statusText: e.message});
  }
}

export async function onRequestPut(ctx) {
  const env = ctx.env;
  const post = ctx.params.post;
  let cache, visited = null;
  try {
    cache = parseRequestCookie(ctx.request);
    if (cache && Object.hasOwn(cache, 'visited')) {
      visited = new Set(cache['visited']);
      if (visited.has(`${post}`))
        return new Response(`Visited previously, returning...`, {status: 200});
    }
    visited = visited || new Set();
    visited.add(`${post}`);
    const cookieHeader = new Headers({
      'Set-Cookie': "visited="+`${JSON.stringify(Array.from(visited.values()))}`,
    })
    let count = await env.BLOG.PAGE_VIEWS.get(`${post}`) || '0';
    const result = await env.BLOG.PAGE_VIEWS.put(`${post}`, String(Number(count) + 1));
    return new Response(`Updated count to ${count+1}`, {status: 200, headers: cookieHeader});
  } catch (e) {
    return new Response(null, {status: 500, statusText: e.message});
  }
}