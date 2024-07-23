// const requestIp = require('request-ip');

// export async function onRequestGet(ctx) {
//   try {
//     let clientIp = requestIp.getClientIp(ctx.request);
//     if (clientIp === null)
//       clientIp = 'localhost';
//     ctx.params.clientIp = clientIp;
//     console.log(`client IP is ${clientIp}`);
//     return await ctx.next();
//   } catch (err) {
//     return new Response(`${err.message}\n${err.stack}`, { status: 500 });
//   }
// }