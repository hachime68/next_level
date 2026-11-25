// Atualiza data/releases.json e data/news.json buscando RAWG, Steam, IGDB e feeds RSS.
// Roda no GitHub Actions (Node 20+, sem dependências). Chaves vêm de variáveis de ambiente:
//   RAWG_API_KEY, TWITCH_CLIENT_ID, TWITCH_CLIENT_SECRET
// Cada fonte é opcional e isolada: se uma falhar (ou não tiver chave), as outras continuam,
// e se NADA funcionar o arquivo antigo é preservado (nunca grava lista vazia por cima).

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DATA_DIR = process.env.DATA_DIR || resolve(ROOT, 'data');
const DAYS_AHEAD = 120;
const TIMEOUT_MS = 15000;

const log = (...a) => console.log(...a);
const warn = (...a) => console.warn('AVISO:', ...a);

// ---------- utilidades ----------
async function http(url, opts = {}) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, { ...opts, signal: ctrl.signal, headers: { 'user-agent': 'NextLevelPortal/1.0', ...(opts.headers || {}) } });
    if (!res.ok) throw new Error(`HTTP ${res.status} em ${new URL(url).host}`);
    return res;
  } finally {
    clearTimeout(t);
  }
}
const iso = (d) => d.toISOString().slice(0, 10);
const normName = (s) => String(s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
const safeUrl = (u) => { try { const x = new URL(u); return /^https?:$/.test(x.protocol) ? x.href : ''; } catch { return ''; } };
async function readJson(path, fallback) { try { return JSON.parse(await readFile(path, 'utf8')); } catch { return fallback; } }

// ---------- fontes de jogos ----------
async function fromRawg() {
  const key = process.env.RAWG_API_KEY;
  if (!key) { warn('RAWG ignorado (sem RAWG_API_KEY)'); return []; }
  const now = new Date(), end = new Date(Date.now() + DAYS_AHEAD * 864e5);
  const url = `https://api.rawg.io/api/games?key=${encodeURIComponent(key)}&dates=${iso(now)},${iso(end)}&ordering=released&page_size=40`;
  const json = await (await http(url)).json();
  return (json.results || []).map((g) => ({
    name: g.name,
    released: g.released || null,
    platforms: (g.platforms || []).map((p) => p.platform?.name).filter(Boolean),
    image: safeUrl(g.background_image),
    url: g.slug ? `https://rawg.io/games/${g.slug}` : '',
    source: 'RAWG',
  }));
}

async function fromSteam() {
  // Endpoint público da loja (não é uma API oficial documentada; pode mudar).
  const json = await (await http('https://store.steampowered.com/api/featuredcategories?cc=br&l=portuguese')).json();
  const out = [];
  for (const [cat, label] of [['coming_soon', 'em breve'], ['new_releases', 'novo']]) {
    for (const it of json?.[cat]?.items || []) {
      if (!it?.id || !it?.name) continue;
      out.push({
        name: it.name,
        released: null,
        platforms: ['PC'],
        image: safeUrl(it.header_image || it.large_capsule_image),
        url: `https://store.steampowered.com/app/${it.id}`,
        source: 'Steam',
        tag: label,
      });
    }
  }
  return out;
}

async function fromIgdb() {
  const id = process.env.TWITCH_CLIENT_ID, secret = process.env.TWITCH_CLIENT_SECRET;
  if (!id || !secret) { warn('IGDB ignorado (sem TWITCH_CLIENT_ID/TWITCH_CLIENT_SECRET)'); return []; }
  const tok = await (await http(`https://id.twitch.tv/oauth2/token?client_id=${encodeURIComponent(id)}&client_secret=${encodeURIComponent(secret)}&grant_type=client_credentials`, { method: 'POST' })).json();
  if (!tok.access_token) throw new Error('IGDB: token não recebido');
  const from = Math.floor(Date.now() / 1000), to = from + DAYS_AHEAD * 86400;
  const body = `fields name,first_release_date,url,cover.image_id,platforms.name,hypes; where first_release_date > ${from} & first_release_date < ${to} & cover != null; sort hypes desc; limit 40;`;
  const res = await http('https://api.igdb.com/v4/games', { method: 'POST', headers: { 'Client-ID': id, Authorization: `Bearer ${tok.access_token}`, 'content-type': 'text/plain' }, body });
  const list = await res.json();
  return (Array.isArray(list) ? list : []).map((g) => ({
    name: g.name,
    released: g.first_release_date ? iso(new Date(g.first_release_date * 1000)) : null,
    platforms: (g.platforms || []).map((p) => p.name).filter(Boolean),
    image: g.cover?.image_id ? `https://images.igdb.com/igdb/image/upload/t_cover_big/${g.cover.image_id}.jpg` : '',
    url: safeUrl(g.url),
    source: 'IGDB',
  }));
}

// junta as fontes, remove duplicados pelo nome e completa campos vazios com a outra fonte
export function mergeGames(lists) {
  const map = new Map();
  for (const g of lists.flat()) {
    if (!g?.name) continue;
    const k = normName(g.name);
    const cur = map.get(k);
    if (!cur) { map.set(k, { ...g, sources: [g.source] }); continue; }
    cur.released ||= g.released;
    cur.image ||= g.image;
    cur.url ||= g.url;
    cur.platforms = [...new Set([...(cur.platforms || []), ...(g.platforms || [])])];
    if (!cur.sources.includes(g.source)) cur.sources.push(g.source);
  }
  return [...map.values()]
    .map(({ source, ...g }) => g)
    .sort((a, b) => (a.released || '9999').localeCompare(b.released || '9999') || a.name.localeCompare(b.name));
}

// ---------- notícias (RSS/Atom, sem dependências) ----------
const decode = (s) => String(s || '')
  .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
  .replace(/<[^>]+>/g, ' ')
  .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#0?39;|&apos;/g, "'")
  .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(+n))
  .replace(/\s+/g, ' ').trim();
const tag = (block, name) => block.match(new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`, 'i'))?.[1];

export function parseFeed(xml, sourceName) {
  const items = [];
  const blocks = xml.match(/<(item|entry)[\s>][\s\S]*?<\/\1>/gi) || [];
  for (const b of blocks) {
    const title = decode(tag(b, 'title'));
    let link = decode(tag(b, 'link'));
    if (!link) link = b.match(/<link[^>]+href=["']([^"']+)["']/i)?.[1] || '';
    const date = tag(b, 'pubDate') || tag(b, 'published') || tag(b, 'updated') || tag(b, 'dc:date');
    const t = date ? new Date(decode(date)) : null;
    const summary = decode(tag(b, 'description') || tag(b, 'summary') || tag(b, 'content:encoded') || '').slice(0, 220);
    const img = b.match(/<(?:media:content|media:thumbnail|enclosure)[^>]+(?:url)=["']([^"']+)["']/i)?.[1] || '';
    if (title && safeUrl(link)) items.push({ title, url: safeUrl(link), date: t && !isNaN(t) ? t.toISOString() : null, summary, image: safeUrl(img), source: sourceName });
  }
  return items;
}

async function fromFeeds() {
  const cfg = await readJson(resolve(ROOT, 'config', 'feeds.json'), { feeds: [] });
  const all = [];
  for (const f of cfg.feeds || []) {
    try {
      const xml = await (await http(f.url)).text();
      const items = parseFeed(xml, f.name).slice(0, 12);
      if (!items.length) warn(`Feed sem itens: ${f.name} (${f.url})`);
      all.push(...items);
    } catch (e) {
      warn(`Feed falhou: ${f.name} — ${e.message}`);
    }
  }
  const seen = new Set();
  return all
    .filter((n) => (seen.has(n.url) ? false : seen.add(n.url)))
    .sort((a, b) => (b.date || '').localeCompare(a.date || ''))
    .slice(0, 40);
}

// ---------- principal ----------
async function settle(label, fn) {
  try { const r = await fn(); log(`${label}: ${r.length} itens`); return r; }
  catch (e) { warn(`${label} falhou — ${e.message}`); return []; }
}

async function main() {
  await mkdir(DATA_DIR, { recursive: true });
  // A Steam fica DESLIGADA por padrão: a lista dela vem sem data e com trilhas sonoras, títulos em outros
  // alfabetos e conteúdo adulto. Para ligar de novo, crie a variável ENABLE_STEAM=1 no workflow.
  const useSteam = process.env.ENABLE_STEAM === '1';
  if (!useSteam) log('Steam: desligada (ENABLE_STEAM não definida)');
  const [rawg, steam, igdb] = await Promise.all([
    settle('RAWG', fromRawg),
    useSteam ? settle('Steam', fromSteam) : Promise.resolve([]),
    settle('IGDB', fromIgdb),
  ]);
  const games = mergeGames([rawg, igdb, steam]);
  const news = await settle('Notícias', fromFeeds);
  const updated = new Date().toISOString();

  const relPath = resolve(DATA_DIR, 'releases.json'), newsPath = resolve(DATA_DIR, 'news.json');
  if (games.length) {
    await writeFile(relPath, JSON.stringify({ updated, games }, null, 1));
    log(`releases.json: ${games.length} jogos`);
  } else warn('Nenhum jogo obtido: releases.json antigo foi mantido.');
  if (news.length) {
    await writeFile(newsPath, JSON.stringify({ updated, news }, null, 1));
    log(`news.json: ${news.length} notícias`);
  } else warn('Nenhuma notícia obtida: news.json antigo foi mantido.');

  if (!games.length && !news.length) process.exitCode = 1; // faz o agendamento mostrar falha
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
