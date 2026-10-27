// Reprise des photos de profil : data URL (base64) dans users.avatar_url
// → JPEG 640 px dans le bucket Storage « avatars » → URL publique en base.
//
//   node scripts/migrate-avatars.mjs           à blanc : lit et convertit, écrit les JPEG
//                                              et le SQL dans --out, n'envoie rien
//   node scripts/migrate-avatars.mjs --apply   envoie aussi les JPEG dans le bucket
//
// Le script n'écrit jamais en base : il produit backfill.sql, à exécuter ensuite
// (éditeur SQL Supabase ou MCP), et restore.sql pour revenir en arrière. Seules
// les photos relues avec succès depuis Storage y figurent ; une ligne n'est
// modifiée que si sa data URL est encore celle convertie (garde md5) et que sa
// copie intacte existe dans avatar_legacy_backups. Les demandes d'inscription
// qui portent la même photo reçoivent la même URL. Rejouable sans risque : les
// fichiers sont nommés d'après le contenu (<id>/legacy-<md5>.jpg).
//
// Utilise la clé publishable du front (lecture de users et ajout dans le bucket,
// comme l'application elle-même) : aucune clé secrète n'est nécessaire.
// Prérequis pour --apply : migration 20261026170000_avatars_storage appliquée.
import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { createClient } from "@supabase/supabase-js";
import sharp from "sharp";

// Mêmes valeurs publiques que client/src/lib/supabase.ts.
const SUPABASE_URL = process.env.SUPABASE_URL || "https://upkzlppvwckriuidnyvq.supabase.co";
const SUPABASE_KEY = process.env.SUPABASE_PUBLISHABLE_KEY || "sb_publishable_36S8t4yZQhYXXMZa3p9ldg_EWnP8gPL";
const BUCKET = "avatars";
const MAX_SIDE = 640;
const BATCH = 4;

const args = process.argv.slice(2);
const apply = args.includes("--apply");
const outIndex = args.indexOf("--out");
const outDir = resolve(outIndex >= 0 ? args[outIndex + 1] : "avatars-backfill");

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: false } });
const kb = (bytes) => `${Math.round(bytes / 1024)} Ko`;
const sqlText = (value) => `'${String(value).replace(/'/g, "''")}'`;

async function toJpeg(dataUrl) {
  const match = /^data:image\/[a-z0-9.+-]+;base64,(.*)$/is.exec(dataUrl);
  if (!match) throw new Error("data URL d'image illisible");
  const input = Buffer.from(match[1], "base64");
  // rotate() applique l'orientation EXIF, comme les navigateurs à l'affichage ;
  // flatten() met un fond blanc sous les PNG transparents.
  const output = await sharp(input)
    .rotate()
    .resize(MAX_SIDE, MAX_SIDE, { fit: "inside", withoutEnlargement: true })
    .flatten({ background: "#ffffff" })
    .jpeg({ quality: 82, mozjpeg: true })
    .toBuffer();
  const { width, height } = await sharp(output).metadata();
  return { output, width, height, inputBytes: input.length };
}

const sha256 = (buffer) => createHash("sha256").update(buffer).digest("hex");

/** Envoie le JPEG puis le relit en entier depuis l'URL publique avant de le déclarer bon. */
async function upload(name, body) {
  const { error } = await supabase.storage.from(BUCKET).upload(name, body, { contentType: "image/jpeg", cacheControl: "31536000", upsert: false });
  // Déjà envoyé lors d'un passage précédent : même nom = même photo d'origine.
  if (error && !/exist|duplicate/i.test(error.message)) throw error;
  const url = supabase.storage.from(BUCKET).getPublicUrl(name).data.publicUrl;
  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok || response.headers.get("content-type") !== "image/jpeg") throw new Error(`relecture ${response.status} ${response.headers.get("content-type")}`);
  const stored = Buffer.from(await response.arrayBuffer());
  if (error) {
    // Fichier d'un passage précédent : il doit au moins être une image JPEG lisible.
    const { format, width, height } = await sharp(stored).metadata();
    if (format !== "jpeg" || !width || !height || Math.max(width, height) > MAX_SIDE) throw new Error(`relecture : fichier existant invalide (${format} ${width}×${height})`);
  } else if (sha256(stored) !== sha256(body)) {
    throw new Error("relecture : contenu différent du fichier envoyé");
  }
  return { url, reused: Boolean(error) };
}

/**
 * SQL de reprise, en une transaction. Une valeur n'est remplacée que si :
 * le fichier a été relu avec succès (seules ces photos figurent dans la liste),
 * la data URL en base est encore celle convertie (md5) et sa copie intacte
 * existe dans avatar_legacy_backups.
 */
export function backfillSql(rows) {
  const values = rows.map((row) => `  (${sqlText(row.id)}, ${sqlText(row.md5)}, ${sqlText(row.url)})`).join(",\n");
  return `-- Reprise des photos de profil, générée par scripts/migrate-avatars.mjs le ${new Date().toISOString()}.
-- ${rows.length} photo(s) envoyée(s) et relue(s) depuis Storage.
begin;

create temporary table converted (id text, md5 text, url text) on commit drop;
insert into converted (id, md5, url) values
${values};

-- 1. Copie intacte des data URL encore en base (complète celle faite par la migration).
insert into public.avatar_legacy_backups (source, row_id, md5, avatar_url)
select 'users', u.id, md5(u.avatar_url), u.avatar_url from public.users u where u.avatar_url like 'data:%'
union all
select 'user_registration_requests', r.id::text, md5(r.avatar_url), r.avatar_url from public.user_registration_requests r where r.avatar_url like 'data:%'
on conflict do nothing;

-- 2. Comptes : URL à la place de la data URL, seulement si la copie existe.
with done as (
  update public.users u
    set avatar_url = c.url
    from converted c
    where u.id = c.id and u.avatar_url like 'data:%' and md5(u.avatar_url) = c.md5
      and exists (select 1 from public.avatar_legacy_backups b
                  where b.source = 'users' and b.row_id = u.id and b.md5 = c.md5 and b.avatar_url = u.avatar_url)
    returning u.id, c.md5, c.url
)
update public.avatar_legacy_backups b
  set storage_url = done.url, verified_at = now()
  from done
  where b.source = 'users' and b.row_id = done.id and b.md5 = done.md5;

-- 3. Demandes d'inscription portant exactement la même photo : même fichier.
with matches as (
  select distinct on (r.id) r.id, b.md5, c.url
    from public.user_registration_requests r
    join public.avatar_legacy_backups b
      on b.source = 'user_registration_requests' and b.row_id = r.id::text and b.avatar_url = r.avatar_url
    join converted c on c.md5 = b.md5
    where r.avatar_url like 'data:%'
    order by r.id, (c.id = r.id::text) desc, c.id
),
done as (
  update public.user_registration_requests r
    set avatar_url = m.url
    from matches m
    where r.id = m.id
    returning r.id, m.md5, m.url
)
update public.avatar_legacy_backups b
  set storage_url = done.url, verified_at = now()
  from done
  where b.source = 'user_registration_requests' and b.row_id = done.id::text and b.md5 = done.md5;

commit;

-- Bilan
select
  (select count(*) from public.users where avatar_url like 'data:%') as users_still_inline,
  (select count(*) from public.user_registration_requests where avatar_url like 'data:%') as requests_still_inline,
  (select count(*) from public.avatar_legacy_backups) as backups,
  (select count(*) from public.avatar_legacy_backups where verified_at is not null) as backups_verified;
`;
}

/** Retour arrière : remet la data URL d'origine partout où la reprise a mis une URL. */
export const RESTORE_SQL = `-- Restauration des photos d'origine depuis avatar_legacy_backups (annule la reprise).
begin;
update public.users u
  set avatar_url = b.avatar_url
  from public.avatar_legacy_backups b
  where b.source = 'users' and b.row_id = u.id and b.storage_url is not null and u.avatar_url = b.storage_url;
update public.user_registration_requests r
  set avatar_url = b.avatar_url
  from public.avatar_legacy_backups b
  where b.source = 'user_registration_requests' and b.row_id = r.id::text and b.storage_url is not null and r.avatar_url = b.storage_url;
commit;
`;

async function main() {
  const { data: ids, error: idsError } = await supabase.from("users").select("id").like("avatar_url", "data:%").order("id");
  if (idsError) throw idsError;
  console.log(`${ids.length} photo(s) en data URL dans users — ${apply ? "ENVOI dans le bucket" : "à blanc (rien n'est envoyé)"}`);
  await mkdir(outDir, { recursive: true });

  const converted = [];
  const failed = [];
  let before = 0;
  let after = 0;
  for (let index = 0; index < ids.length; index += BATCH) {
    const batchIds = ids.slice(index, index + BATCH).map((row) => row.id);
    const { data, error } = await supabase.from("users").select("id, avatar_url").in("id", batchIds);
    if (error) throw error;
    for (const row of data) {
      if (!row.avatar_url?.startsWith("data:")) continue;
      try {
        const md5 = createHash("md5").update(row.avatar_url, "utf8").digest("hex");
        const name = `${row.id}/legacy-${md5.slice(0, 12)}.jpg`;
        const { output, width, height, inputBytes } = await toJpeg(row.avatar_url);
        await writeFile(join(outDir, name.replace("/", "__")), output);
        const result = apply ? await upload(name, output) : { url: supabase.storage.from(BUCKET).getPublicUrl(name).data.publicUrl, reused: false };
        converted.push({ id: row.id, md5, url: result.url });
        before += row.avatar_url.length;
        after += output.length;
        console.log(`  ${row.id.padEnd(38)} ${kb(row.avatar_url.length).padStart(7)} en base (${kb(inputBytes)} d'image) → ${kb(output.length).padStart(6)}  ${width}×${height}${apply ? (result.reused ? "  déjà envoyé" : "  envoyé") : ""}`);
      } catch (error) {
        failed.push(row.id);
        console.log(`  ${row.id.padEnd(38)} ÉCHEC : ${error.message}`);
      }
    }
  }

  // À blanc, les URL ne pointent encore vers rien : le SQL n'est qu'un aperçu.
  const sqlFile = join(outDir, apply ? "backfill.sql" : "backfill.preview.sql");
  await writeFile(sqlFile, backfillSql(converted));
  await writeFile(join(outDir, "restore.sql"), RESTORE_SQL);
  console.log(`\n${converted.length} convertie(s), ${failed.length} échec(s) : ${kb(before)} en base → ${kb(after)} de fichiers`);
  console.log(`JPEG : ${outDir}\nSQL  : ${sqlFile}`);
  if (!apply) console.log("À blanc : relancer avec --apply pour envoyer les fichiers, puis exécuter backfill.sql.");
  return failed.length ? 1 : 0;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) process.exit(await main());
