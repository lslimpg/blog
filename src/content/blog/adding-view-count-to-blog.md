---
title: Adding View Count to Blog
author: Li-Sha Lim
pubDatetime: 2024-07-27T23:43:02Z
slug: adding-view-count-to-blog
featured: false
draft: false
tags:
  - Cloudflare KV
  - serverless
  - cookies
description: Adding page view count using Cloudflare KV and cookies
---

I've taken a slight detour from working on dream-world, as I felt that my blog could use a few extra features than what it currently has out-of-box. Two features which I would like my blog to have are page views and comments, and this post covers the steps I've taken to implement the former.

Keeping track of page views is a rather simple feature, and so is a perfect first "mini-project" for me to get my feet wet with using some kind of datastore. Having set up this site using [Cloudflare Pages](https://pages.cloudflare.com/), I've been really impressed with how easy deployment is, where everything _just works_. So this gave me a chance to explore their other products.

Going through their different [storage products](https://developers.cloudflare.com/workers/platform/storage-options/), it ultimately came to a choice between two:

- [Workers KV](https://developers.cloudflare.com/kv/)
- [D1 SQL database](https://developers.cloudflare.com/d1/)

The decision would have been clear right away to the more seasoned developer, but I ultimately went with KV, as I reasoned that basically a key value pair is all that's needed to store the view count per page. Now, at the time of writing this however, I could see how D1 could be useful, if for example, I wanted to further extend this page count feature by keeping track of only the unique visits. But for now, KV would suffice. And while KV is only eventually consistent, it's not a big deal in this case, as I don't really care about getting the exact views per page, an approximate value would be satisfactory.

## Implementation

On the astro side, I created a react component `ViewCount.tsx`.

```js
import { useState, useEffect } from "react";

export interface Props {
  title: string;
}

export default function ViewCount({ title }: Props) {
  const [viewCount, setViewCount] = useState(0);

  useEffect(() => {
    const getViewCount = async () => {
      try {
        const resp = await fetch(`/api/views/${title}`);
        if (resp.ok) {
          const count = await resp.json();
          setViewCount(count + 1);
        } else setViewCount(viewCount + 1);
      } catch (e) {
        console.error(`Error: ` + e);
      }
    };

    getViewCount();

    return () => {
      fetch(`/api/views/${title}`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
        },
      }).catch(e => console.error(`Error updating views: ` + e));
    };
  }, []);

  return <span>Viewed {viewCount} times</span>;
}
```

The idea of this is for the component to fetch the page view count on load and first mount, and when the user is done viewing, send a put request to update the view count.

Since Astro adopts a server-first approach to rendering, opt-ins to client side rendering needs to be explicitly added, without the `client` directive below, the request to fetch the views won't be made from the client side:
`<ViewCount client:only title={title} />`

To implement the "back-end" side of this, I made use of Cloudflare's [Pages Functions](https://developers.cloudflare.com/pages/functions/). Having not dealt with serverless functions before, I have to say that my experience getting them to work has been really smooth, and almost frictionless. This is in pretty stark contrast to the debugging that I deal with at work, working with kernel drivers. To debug issues with kernel drivers, I have to depend entirely on making sense of kernel logs, and there is no way of adding breakpoints, stepping through code and inspecting local variables dynamically. And if the bug involves a kernel panic, I would have to extract ram dumps. If I wanted to view local variables at time of crash, at work we use a debugging tool called t32, and that is awfully slow. Of course, in getting this view count feature to work, not everything I wrote worked right away, and I still had to debug and fix my mistakes, but the process has been relatively pain-free.

To enable Pages Functions, a `/functions` directory has to be made at the root of the site, which in my case is the astro blog src. Then, the path within `functions/` will get matched. Online [documentation](https://developers.cloudflare.com/pages/functions/routing/) provides good examples on usage.

I made use of their dynamic routing feature, with the dynamic route/value being the title of the page. The idea is that the title of the page is the "key", and the views is the "value". These functions connect to the KV by way of [binding](https://developers.cloudflare.com/workers/runtime-apis/bindings/), which is a way for the Pages functions to interact with KV. `BLOG_PAGE_VIEWS` is the name of my KV namespace. The binding can be done through two ways, either through [Wrangler](https://developers.cloudflare.com/workers/wrangler/), or through the online dashboard. Since Wrangler provides additional features such as the option to test locally, I went with Wrangler. To test with Wrangler, I found that the astro side of the code needs to be built first using `npm run build`, then `npx wrangler dev --local`.

The code to fetch and update the views:

```js
export async function onRequestGet(ctx) {
  const env = ctx.env;
  const post = ctx.params.post;
  try {
    const count = await env.BLOG_PAGE_VIEWS.get(`${post}`);
    if (count === null) {
      return new Response(null, { status: 404, statusText: "count not found" });
    }
    return new Response(Number(count), { status: 200 });
  } catch (e) {
    return new Response(null, { status: 500, statusText: e.message });
  }
}

export async function onRequestPut(ctx) {
  const env = ctx.env;
  const post = ctx.params.post;
  let cache,
    visited = null;
  try {
    cache = parseRequestCookie(ctx.request);
    if (cache && Object.hasOwn(cache, "visited")) {
      visited = new Set(cache["visited"]);
      if (visited.has(`${post}`))
        return new Response(`Visited previously, returning...`, {
          status: 200,
        });
    }
    visited = visited || new Set();
    visited.add(`${post}`);
    const cookieHeader = new Headers({
      "Set-Cookie":
        "visited=" + `${JSON.stringify(Array.from(visited.values()))}`,
    });
    let count = (await env.BLOG_PAGE_VIEWS.get(`${post}`)) || "0";
    const result = await env.BLOG_PAGE_VIEWS.put(
      `${post}`,
      String(Number(count) + 1)
    );
    return new Response(`Updated count to ${count + 1}`, {
      status: 200,
      headers: cookieHeader,
    });
  } catch (e) {
    return new Response(null, { status: 500, statusText: e.message });
  }
}
```

While testing out the page views feature locally, I decided I wanted to add a bit more code so that the view count does not artificially inflate, when a user revists a page or on a page refresh for example. To that end, I made use of cookies, with the idea to store the visited pages by the user. The cookies are just session ones.

Since cookies are encoded in the form of strings, I have to add a bit of code to massage the data:

```js
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
```

## Conclusion

While coming to the end of working on this, I discovered that all along, Cloudflare may already have what I needed in the form of [Web Analytics](https://www.cloudflare.com/web-analytics/). Theirs is probably a more complete solution, but this has still been a good exercise. In the meantime, I will read more into this offering, and decide on if to migrate to their solution.

Till next time!
