import { neon } from '@neondatabase/serverless';

let sqlSingleton = null;
export function getSql() {
  if (!sqlSingleton) {
    const conn =
      process.env.NEON_DATABASE_URL ||
      process.env.NETLIFY_DATABASE_URL_UNPOOLED ||
      process.env.NETLIFY_DATABASE_URL;
    if (!conn) throw new Error("Missing env NEON_DATABASE_URL");
    sqlSingleton = neon(conn);
  }
  return sqlSingleton;
}
export function json(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}
export function handleOptions() {
  return new Response(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET,POST,PATCH,OPTIONS,HEAD",
      "Access-Control-Allow-Headers": "Content-Type, Authorization, x-user-email"
    }
  });
}