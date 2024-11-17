---
title: Adding View Count to Blog
author: Li-Sha Lim
pubDatetime: 2024-07-27T23:43:02Z
slug: adding-view-count-to-blog
featured: false
draft: false
tags:
  - cloudflare-kv
  - serverless
  - cookies
  - graphql
  - cloudflare-d1
description: Exploring different methods to update view count
---

## Table of Contents

I'd like my blog to have a few extra features than what it currently has out-of-box. Those two being page views and comments, and this post covers the steps I've taken to implement the former.

## Using Cookies + Cloudflare KV

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

## Getting page views through Cloudflare GraphQL

Coming to the end of working through the first solution, I realised that Cloudflare exposes a graphql API for [Web Analytics](https://www.cloudflare.com/web-analytics/), and I thought I should give it a try.

Their analytics allows us to get detailed analytics metrics such as page views, unique visitors, and visit durations. Some of these metrics are already displayed on the developer dashboard:
![cf-dashboard-view](@assets/images/cf-dashboard-view.png)

I wanted my view count on each page to reflect what I'm seeing on the dashboard. Coming back to this after a few months of deploying the KV + cookie method, I'm seeing a disparity in the view count, and I'm not quite sure why. Although the view count through CF seems to log new visits, the existing view count remained stagnant. And from what I've researched, one explanation why could be that CF does count a page reload as a new visit. But, the stats do show visits from Mac platforms, and
being that I'm not on any, those should be new. I haven't quite figured out the reason yet, and will come back to this later when I do find out why.

I haven't had any experience using graphql, and having CoPilot enabled, I figured I'd ask it how to generate a query to get page views. Perhaps I'm new to both tools, and my prompt wasn't precise enough, but the suggestion from copilot wasn't working.
It took quite a bit of digging, but what actually helped was [capturing the graphql request using DevTools](https://developers.cloudflare.com/analytics/graphql-api/tutorials/capture-graphql-queries-from-dashboard/).

The query extracted was quite long, but after simplifying it to what I wanted, it looked like this:

```js
query GetRumAnalyticsTopNs {
  viewer {
    accounts(filter: { accountTag: $accountTag }) {
      total: rumPageloadEventsAdaptiveGroups(filter: $filter, limit: 1) {
        count
      }
    }
  }
}
```

rum basically stands for Real User Monitoring, which reflects views loaded by a user and discounts those loaded by bots.

The next part was figuring out how to configure secrets correctly. Initially, I thought it was through [astro](https://docs.astro.build/en/guides/environment-variables/). But since I'm accessing these secrets within the context of CF functions, these should actually be configured using CF's [setup](https://developers.cloudflare.com/workers/configuration/secrets/).

One gotcha of depending on this API is that CF only provides a running count of the past 30 days at maximum. To deal with this,
I decided to update the view count of all posts once per day, this time using [D1](https://developers.cloudflare.com/d1/get-started/#4-run-a-query-against-your-d1-database), and [Cron Trigger](https://developers.cloudflare.com/workers/configuration/cron-triggers/).

## Conclusion

Although it's a simple feature, it's enabled me to get my feet wet with a few different CF products. I've left the cookie method running in the background of my code, having both of these run side by side so I can get further concrete metrics to work with. It's a fun few hours on the weekend learning something new!
