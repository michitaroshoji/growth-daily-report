// ============================================================
// Supabase マイグレーション適用スクリプト
//
//   npm run db:migrate      未適用の .sql を版番号順に流す
//   npm run db:migrate:dry  流す予定のファイルを表示するだけ（--dry-run）
//
// 接続先は環境変数 SUPABASE_DB_URL（Postgres の接続文字列）から読む。
// .env に書いておいても拾う（.env は .gitignore 済み）。
//
// 適用済みのファイル名は public.schema_migrations に記録する。
// 次回はそこに無いものだけを流すので、同じファイルが二度流れることはない。
//
// 【重要】schema.sql 〜 schema_v10_knowledge.sql は本番へ適用済みのため、
// 初回実行時は「流さずに記録だけ」する（BASELINE_FILES）。流し直すと
// schema.sql / schema_v2.sql の anon 全許可ポリシーが復活して認証が
// 無効化されるうえ、schema.sql 末尾の on conflict (name) がエラーになる。
// 詳しくは README「セットアップ手順」を参照。
// ============================================================
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SQL_DIR = join(ROOT, 'supabase');

// schema.sql は版番号が付いていないが v1 相当（いちばん最初）
const BASE_FILE = 'schema.sql';
const BASE_VERSION = 1;

// schema_v11_departments.sql のような名前から版番号を取り出す
const VERSIONED_PATTERN = /^schema_v(\d+)(?:_[0-9a-z_]+)?\.sql$/;

// 本番へ適用済み。初回実行時は「流さずに記録だけ」する
const BASELINE_FILES = [
  'schema.sql',
  'schema_v2.sql',
  'schema_v3.sql',
  'schema_v4.sql',
  'schema_v5_auth.sql',
  'schema_v6_admin.sql',
  'schema_v7_manual.sql',
  'schema_v8_demo_write.sql',
  'schema_v9_cancelled.sql',
  'schema_v10_knowledge.sql',
];

// 初回実行の前提チェックに使うテーブル。
// これらが無い＝v1〜v10 が未適用なので、baseline を記録してしまうと
// 「流していないのに適用済み」という嘘の記録が残る
const BASELINE_TABLES = [
  { table: 'public.daily_reports', file: 'schema.sql' },
  { table: 'public.knowledge_memos', file: 'schema_v10_knowledge.sql' },
];

// ============================================================
// ファイルの並び替え（ここが辞書順だと v10 が v2 より前に来てしまう）
// ============================================================

// supabase/ のファイル名一覧を、版番号の小さい順に並べ替えて返す。
// マイグレーションではないもの（migrate_user_a.sql など）は skipped に分ける。
export function listMigrations(fileNames) {
  const migrations = [];
  const skipped = [];

  for (const file of fileNames) {
    if (file === BASE_FILE) {
      migrations.push({ file, version: BASE_VERSION });
      continue;
    }
    const matched = VERSIONED_PATTERN.exec(file);
    if (matched) {
      migrations.push({ file, version: Number(matched[1]) });
    } else {
      skipped.push(file);
    }
  }

  // 辞書順ではなく版番号の数値で比較する
  migrations.sort((a, b) => a.version - b.version);

  // 同じ版番号のファイルが2つあると、どちらを先に流すべきか決められない
  for (let i = 1; i < migrations.length; i += 1) {
    if (migrations[i].version === migrations[i - 1].version) {
      throw new Error(
        `版番号が重複しています: ${migrations[i - 1].file} と ${migrations[i].file}`
      );
    }
  }

  return { migrations, skipped };
}

// 適用済み（applied）に入っていないものだけを、版番号順のまま返す
export function pendingMigrations(migrations, applied) {
  const done = new Set(applied);
  return migrations.filter((m) => !done.has(m.file));
}

function readSqlDir() {
  return listMigrations(readdirSync(SQL_DIR).filter((file) => file.endsWith('.sql')).sort());
}

// ============================================================
// 接続文字列
// ============================================================

// .env から1つだけ値を取り出す（dotenv を足さずに済ませる。seed-demo.mjs と同じやり方）
function readFromEnvFile(key) {
  const path = join(ROOT, '.env');
  if (!existsSync(path)) return undefined;

  for (const line of readFileSync(path, 'utf8').split('\n')) {
    const text = line.trim();
    if (!text || text.startsWith('#')) continue;
    const at = text.indexOf('=');
    if (at > 0 && text.slice(0, at).trim() === key) return text.slice(at + 1).trim();
  }
  return undefined;
}

function readDbUrl() {
  return process.env.SUPABASE_DB_URL || readFromEnvFile('SUPABASE_DB_URL') || '';
}

// ログに出してよいのはホスト名だけ。ユーザー名・パスワードは絶対に出さない
function hostOf(dbUrl) {
  try {
    return new URL(dbUrl).host;
  } catch {
    return '(接続文字列を解釈できませんでした)';
  }
}

// ============================================================
// DB 側の処理
// ============================================================

async function ensureMigrationsTable(client) {
  // public に置くので anon / authenticated からは触れないようにしておく
  // （RLS を有効にしてポリシーを1つも作らない＝誰も読めない）
  await client.query(`
    create table if not exists public.schema_migrations (
      filename    text primary key,
      applied_at  timestamptz not null default now()
    );
    alter table public.schema_migrations enable row level security;
    revoke all on public.schema_migrations from anon, authenticated;
  `);
}

async function fetchApplied(client) {
  const { rows } = await client.query('select filename from public.schema_migrations');
  return rows.map((row) => row.filename);
}

// 初回実行かどうかは「記録が1件も無いか」で判断する
async function seedBaseline(client) {
  for (const { table, file } of BASELINE_TABLES) {
    const { rows } = await client.query('select to_regclass($1) as found', [table]);
    if (!rows[0].found) {
      throw new Error(
        `${table} がありません。初期セットアップ（${file} まで）が済んでいないDBのようです。\n` +
          '  README「セットアップ手順」に従って schema.sql 〜 schema_v10_knowledge.sql を\n' +
          '  SQL Editor で流してから、もう一度実行してください。'
      );
    }
  }

  await client.query(
    'insert into public.schema_migrations (filename) select unnest($1::text[]) on conflict do nothing',
    [BASELINE_FILES]
  );
  console.log(`適用済みとして記録しました（流していません）: ${BASELINE_FILES.length}件`);
}

async function applyMigration(client, file) {
  const sql = readFileSync(join(SQL_DIR, file), 'utf8');

  // 途中で失敗したら、そのファイルの変更も記録もまとめて無かったことにする
  await client.query('begin');
  try {
    await client.query(sql);
    await client.query('insert into public.schema_migrations (filename) values ($1)', [file]);
    await client.query('commit');
  } catch (error) {
    await client.query('rollback');
    throw new Error(`${file} の適用に失敗しました（変更は取り消しました）\n  → ${error.message}`);
  }
}

// ============================================================
// 表示
// ============================================================

function printPlan(pending, skipped) {
  if (skipped.length > 0) {
    console.log(`対象外（マイグレーションではないファイル）: ${skipped.join(' / ')}`);
  }

  if (pending.length === 0) {
    console.log('未適用のファイルはありません。');
    return;
  }

  console.log(`未適用 ${pending.length}件（この順に流します）:`);
  pending.forEach((m, i) => console.log(`  ${i + 1}. ${m.file}`));
}

// ============================================================
// 本体
// ============================================================

async function main() {
  const dryRun = process.argv.includes('--dry-run');
  const dbUrl = readDbUrl();
  const { migrations, skipped } = readSqlDir();

  // ---------- 接続先が無いとき ----------
  if (!dbUrl) {
    if (!dryRun) {
      console.error(
        '環境変数 SUPABASE_DB_URL が設定されていないため、何もせずに終了します。\n' +
          '  Supabase ダッシュボード > Project Settings > Database の\n' +
          '  Connection string（Postgres の接続文字列）を SUPABASE_DB_URL に設定してください。\n' +
          '  例: export SUPABASE_DB_URL=... もしくは .env に SUPABASE_DB_URL=... の行を足す\n' +
          '  流す予定だけ見たいときは: npm run db:migrate:dry'
      );
      process.exit(1);
    }

    // dry-run は DB に繋がなくても確認できるようにしておく。
    // 適用済みの記録が読めないので「初回実行と同じ前提」で計算する
    console.log('SUPABASE_DB_URL が未設定のため、DBには接続しません。');
    console.log('初回実行と同じ前提（schema.sql 〜 schema_v10_knowledge.sql は適用済み）で表示します。\n');
    printPlan(pendingMigrations(migrations, BASELINE_FILES), skipped);
    return;
  }

  // ---------- 接続する ----------
  const { default: pg } = await import('pg');
  const client = new pg.Client({
    connectionString: dbUrl,
    // sslmode が接続文字列に無いときだけ SSL を有効にする
    // （証明書の検証で弾かれる場合は接続文字列に ?sslmode=no-verify を付ける）
    ssl: /[?&]sslmode=/.test(dbUrl) ? undefined : true,
  });

  console.log(`接続先: ${hostOf(dbUrl)}`);
  await client.connect();

  try {
    await ensureMigrationsTable(client);

    let applied = await fetchApplied(client);
    if (applied.length === 0) {
      if (dryRun) {
        console.log('適用済みの記録がありません。初回実行では次を「流さずに記録だけ」します:');
        console.log(`  ${BASELINE_FILES.join(' / ')}\n`);
      } else {
        await seedBaseline(client);
      }
      applied = BASELINE_FILES;
    }

    const pending = pendingMigrations(migrations, applied);
    printPlan(pending, skipped);

    if (dryRun) {
      console.log('\n--dry-run のため、実際には流していません。');
      return;
    }

    for (const m of pending) {
      await applyMigration(client, m.file);
      console.log(`  適用しました: ${m.file}`);
    }
    if (pending.length > 0) console.log(`\n完了しました。${pending.length}件を適用しました。`);
  } finally {
    await client.end();
  }
}

// テストから読み込んだときは実行しない
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error('\n失敗しました:\n' + error.message);
    process.exit(1);
  });
}
