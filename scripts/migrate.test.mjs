// ============================================================
// マイグレーションの並び順・対象の切り分けのテスト
//
//   npm test
//
// DBには繋がない。ファイル名の扱いだけを確かめる。
// ============================================================
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { listMigrations, pendingMigrations } from './migrate.mjs';

const SQL_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'supabase');
const sqlFiles = () => readdirSync(SQL_DIR).filter((file) => file.endsWith('.sql')).sort();

// 本番へ適用済みのもの（migrate.mjs の BASELINE_FILES と同じ並び）
const BASELINE = [
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

test('辞書順ではなく版番号順に並ぶ（v10 が v2 より後）', () => {
  const { migrations } = listMigrations(['schema_v10_knowledge.sql', 'schema_v11_departments.sql', 'schema_v2.sql']);

  assert.deepEqual(
    migrations.map((m) => m.file),
    ['schema_v2.sql', 'schema_v10_knowledge.sql', 'schema_v11_departments.sql']
  );
});

test('schema.sql は v1 相当でいちばん最初に来る', () => {
  const { migrations } = listMigrations(['schema_v2.sql', 'schema.sql']);

  assert.deepEqual(migrations[0], { file: 'schema.sql', version: 1 });
});

test('migrate_user_a.sql は対象外になる', () => {
  const { migrations, skipped } = listMigrations(sqlFiles());

  assert.deepEqual(skipped, ['migrate_user_a.sql']);
  assert.ok(!migrations.some((m) => m.file === 'migrate_user_a.sql'));
});

test('版番号が重複していたら止まる', () => {
  assert.throws(
    () => listMigrations(['schema_v2.sql', 'schema_v2_extra.sql']),
    /版番号が重複/
  );
});

test('初回実行では v11・v12・v13 の3つだけが、この順に流れる', () => {
  const { migrations } = listMigrations(sqlFiles());

  assert.deepEqual(
    pendingMigrations(migrations, BASELINE).map((m) => m.file),
    ['schema_v11_departments.sql', 'schema_v12_restricted_demo.sql', 'schema_v13_release_notes.sql']
  );
});

test('適用済みのものは二度と流れない', () => {
  const { migrations } = listMigrations(sqlFiles());
  const all = migrations.map((m) => m.file);

  assert.deepEqual(pendingMigrations(migrations, all), []);
});

test('supabase/ のファイルは全部どちらかに振り分けられる', () => {
  const files = sqlFiles();
  const { migrations, skipped } = listMigrations(files);

  assert.equal(migrations.length + skipped.length, files.length);
});
