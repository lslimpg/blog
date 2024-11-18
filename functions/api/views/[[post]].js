function parseRequestCookie(req) {
  let cookieObj = {};
  let tokens, cookie;

  if (!req.headers.has("cookie")) return null;

  cookie = req.headers.get("cookie");
  tokens = cookie.split(/=|;/);

  if (tokens.length % 2 !== 0) {
    console.warn(`Token length not even: ${tokens.length}`);
  }

  for (let i = 0; i < tokens.length / 2; i++) {
    cookieObj[tokens[i * 2].trim()] = JSON.parse(tokens[i * 2 + 1].trim());
  }

  return cookieObj;
}

async function getPageViewThruKVCookieMethod(ctx) {
  const env = ctx.env;
  const params = ctx.params.post;
  const post = params[params.length - 1];

  let count = await env.BLOG_PAGE_VIEWS.get(`${post}`);

  return count;
}

async function updatePageViewThruKVCookieMethod(ctx) {
  const env = ctx.env;
  const params = ctx.params.post;
  const post = params[params.length - 1];
  let cache,
    visited = null;

  cache = parseRequestCookie(ctx.request);
  if (cache && Object.hasOwn(cache, "visited")) {
    visited = new Set(cache["visited"]);
    if (visited.has(`${post}`))
      return new Response(`Visited previously, returning...`, { status: 200 });
  }
  visited = visited || new Set();
  visited.add(`${post}`);
  const cookieHeader = new Headers({
    "Set-Cookie":
      "visited=" + `${JSON.stringify(Array.from(visited.values()))}`,
  });
  let count = (await env.BLOG_PAGE_VIEWS.get(`${post}`)) || "0";
  await env.BLOG_PAGE_VIEWS.put(`${post}`, String(Number(count) + 1));
  return new Response(`Updated count to ${count + 1}`, {
    status: 200,
    headers: cookieHeader,
  });
}

function flattenObject(obj) {
  const flattened = {};

  Object.keys(obj).forEach(key => {
    if (typeof obj[key] === "object" && obj[key] !== null) {
      Object.assign(flattened, flattenObject(obj[key]));
    } else {
      flattened[key] = obj[key];
    }
  });

  return flattened;
}

async function queryDB(ctx) {
  const params = ctx.params.post;
  const post = params[params.length - 1];
  const query = `
    SELECT totalViews
    AS totalViews
    FROM Page_Views
    WHERE post = ?1
  `;
  const total = await ctx.env.DB.prepare(query)
    .bind(`${post}`)
    .first("totalViews");
  return total;
}

async function updateDB(insert, totalViews, ctx) {
  const params = ctx.params.post;
  const post = params[params.length - 1];
  const lastUpdated = new Date().toISOString().split("T")[0];
  const query = insert
    ? `INSERT INTO Page_Views (post, totalViews, lastUpdated) VALUES (?1, ?2, ?3)`
    : `
    UPDATE Page_Views
    SET totalViews = ?2, lastUpdated = ?3
    WHERE post = ?1
  `;
  try {
    const { success } = await ctx.env.DB.prepare(query)
      .bind(`${post}`, totalViews, lastUpdated)
      .run();
    return success;
  } catch (e) {
    console.error(e.message);
    return null;
  }
}

async function getPageViewThruCFAnalytics(ctx) {
  const params = ctx.params.post;
  const today = new Date(),
    yesterday = new Date(today.getTime() - 24 * 60 * 60 * 1000);
  let pathUrl = "/";

  for (let p of params) {
    pathUrl += p + "/";
  }

  const resp = await fetch("https://api.cloudflare.com/client/v4/graphql", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-AUTH-EMAIL": `${ctx.env.X_AUTH_EMAIL}`,
      "X-AUTH-KEY": `${ctx.env.X_AUTH_KEY}`,
    },
    body: JSON.stringify({
      query: `query GetRumAnalyticsTopNs {
  viewer {
    accounts(filter: { accountTag: $accountTag }) {
      total: rumPageloadEventsAdaptiveGroups(filter: $filter, limit: 1) {
        count
      }
    }
  }
}`,
      variables: {
        accountTag: `${ctx.env.ACCOUNT_TAG}`,
        filter: {
          AND: [
            {
              datetime_geq: `${yesterday.toISOString()}`,
              datetime_leq: `${today.toISOString()}`,
            },
            {
              bot: 0,
            },
            {
              requestPath: `${pathUrl}`,
            },
          ],
        },
      },
    }),
  });
  const res = await resp.json();
  console.log(res);
  return res;
}

export async function onRequestGet(ctx) {
  try {
    let res = await getPageViewThruCFAnalytics(ctx);
    let { count, errors } = flattenObject(res);
    count = count || 0;
    console.log(count);
    if (errors) {
      return new Response(null, { status: 500, statusText: errors });
    }
    let totalViews = (await queryDB(ctx)) || 0;
    console.log(totalViews);
    if (!res) {
      return new Response(null, {
        status: 500,
        statusText: "DB update failed",
      });
    }
    // const count = await getPageViewThruKVCookieMethod(ctx);
    // if (count === null) {
    //   return new Response(null, {status: 404, statusText: "count not found"});
    // }
    return new Response(totalViews, { status: 200 });
  } catch (e) {
    return new Response(null, { status: 500, statusText: e.message });
  }
}

export async function onRequestPut(ctx) {
  try {
    return updatePageViewThruKVCookieMethod(ctx);
  } catch (e) {
    return new Response(null, { status: 500, statusText: e.message });
  }
}
