export default async (event) => {
  return new Response(JSON.stringify({
    has_NEON_DATABASE_URL: !!process.env.NEON_DATABASE_URL,
    has_NETLIFY_DATABASE_URL: !!process.env.NETLIFY_DATABASE_URL,
    has_NETLIFY_DATABASE_URL_UNPOOLED: !!process.env.NETLIFY_DATABASE_URL_UNPOOLED,
    node: process.version
  }), { status:200, headers:{'content-type':'application/json','Access-Control-Allow-Origin':'*'} });
}