export async function onRequest(context) {
  console.log(context.request);
  return new Response(JSON.stringify("Hello, world!"))
}