// Throwaway connectivity test for OpenAI + Twitter. Prints no secrets.
import dotenv from "dotenv";
import fs from "node:fs";
import OpenAI from "openai";
import { TwitterApi } from "twitter-api-v2";
import { createClient } from "@supabase/supabase-js";

dotenv.config();

function ok(msg) { console.log("  ✅ " + msg); }
function bad(msg) { console.log("  ❌ " + msg); }

// ---------- OpenAI ----------
console.log("\n=== OpenAI ===");
try {
  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const model = process.env.OPENAI_MODEL || "gpt-4o-mini";
  const r = await client.chat.completions.create({
    model,
    max_tokens: 5,
    messages: [{ role: "user", content: "Reply with the single word: pong" }],
  });
  const text = r.choices[0]?.message?.content?.trim();
  ok(`Auth works. model=${model} replied: "${text}"`);
} catch (e) {
  bad(`OpenAI failed: ${e.status || ""} ${e.message}`);
}

// ---------- Twitter ----------
console.log("\n=== Twitter / X ===");
const tw = new TwitterApi({
  appKey: process.env.TWITTER_APP_KEY,
  appSecret: process.env.TWITTER_APP_SECRET,
  accessToken: process.env.TWITTER_ACCESS_TOKEN,
  accessSecret: process.env.TWITTER_ACCESS_SECRET,
});

// 1) Identity / auth check (read).
let authedUser = null;
try {
  const me = await tw.v2.me();
  authedUser = me.data;
  ok(`Auth works. Logged in as @${me.data.username} (id ${me.data.id})`);
} catch (e) {
  bad(`Auth (v2.me) failed: ${e.code || e.status || ""} ${e.message}`);
}

// 2) Search capability check (depends on API tier).
try {
  const terms = (process.env.SEARCH_TERMS || "#ai").split(",")[0].trim();
  const res = await tw.v2.search(terms, { max_results: 10 });
  const count = res.tweets?.length ?? 0;
  ok(`Search works. Query "${terms}" returned ${count} tweet(s) this page.`);
} catch (e) {
  const code = e.code || e.status || "";
  if (code === 403) {
    bad(`Search returned 403 — your X API access tier likely can't use recent search (needs Basic+).`);
  } else if (code === 429) {
    bad(`Search rate-limited (429) — auth is fine, just throttled. Try again later.`);
  } else {
    bad(`Search failed: ${code} ${e.message}`);
  }
}

// ---------- Supabase ----------
console.log("\n=== Supabase ===");
try {
  const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { persistSession: false } }
  );

  // Insert a marker row, read it back, then delete it.
  const marker = "connectivity-test";
  const ins = await supabase
    .from("bot_logs")
    .insert({ action: marker, status: "success", reason: "test-keys.mjs probe" })
    .select("id")
    .single();
  if (ins.error) throw ins.error;

  const id = ins.data.id;
  ok(`Insert works (row id ${id}).`);

  const del = await supabase.from("bot_logs").delete().eq("id", id);
  if (del.error) throw del.error;
  ok("Delete works (test row cleaned up). RLS/service-role access confirmed.");
  fs.writeFileSync("supabase-result.json", JSON.stringify({ ok: true, insertedId: id }));
} catch (e) {
  bad(`Supabase failed: ${e.code || ""} ${e.message}`);
  fs.writeFileSync(
    "supabase-result.json",
    JSON.stringify({ ok: false, code: e.code || null, message: e.message })
  );
}

console.log("\nNote: this test did NOT like or reply to anything.");
if (authedUser) {
  console.log("Tip: to confirm WRITE access (like/reply), the app must have Read+Write");
  console.log("permission and tokens regenerated after enabling it.");
}
