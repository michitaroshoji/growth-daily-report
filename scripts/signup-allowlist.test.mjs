// ============================================================
// アカウント作成のドメイン制限（schema_v15_signup_allowlist.sql）のテスト
//
//   npm test
//
// DBには繋がない。SQLを読んで、崩れると困る前提だけを確かめる。
//   ・許可ドメインの一覧が1か所にまとまっていること
//   ・管理者の逃げ道（ADMIN_EMAILS）が許可ドメインに入っていること
//   ・拒否と、社外デモ用アカウントの通し道が残っていること
// ============================================================
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { ADMIN_EMAILS } from '../src/permissions.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SQL_FILE = join(ROOT, 'supabase', 'schema_v15_signup_allowlist.sql');
const sql = readFileSync(SQL_FILE, 'utf8');

// signup_allowed_domains() の array[...] から、並んでいるドメインを取り出す
function allowedDomains(text) {
  const body = /create or replace function public\.signup_allowed_domains\(\)[\s\S]*?array\[([\s\S]*?)\]/.exec(text);
  assert.ok(body, 'signup_allowed_domains() の array[...] が見つかりません');
  return [...body[1].matchAll(/'([^']+)'/g)].map((m) => m[1]);
}

test('許可ドメインの一覧が読み取れて、社内ドメインが入っている', () => {
  assert.deepEqual(allowedDomains(sql), ['teetime.co.jp']);
});

test('許可ドメインはすべて小文字（比較する側と揃える）', () => {
  for (const domain of allowedDomains(sql)) {
    assert.equal(domain, domain.toLowerCase());
  }
});

test('一覧は1か所にしか無い（増やすときに直す場所が1つ）', () => {
  const files = readdirSync(join(ROOT, 'supabase')).filter((file) => file.endsWith('.sql'));
  const defined = files.filter((file) =>
    readFileSync(join(ROOT, 'supabase', file), 'utf8').includes('function public.signup_allowed_domains()')
  );

  assert.deepEqual(defined, ['schema_v15_signup_allowlist.sql']);
});

test('管理者の逃げ道（ADMIN_EMAILS）のドメインは許可されている', () => {
  // ここが外れていると、role を戻すための管理者アカウントを作り直せなくなる
  const allowed = allowedDomains(sql);

  for (const email of ADMIN_EMAILS) {
    assert.ok(
      allowed.includes(email.toLowerCase().split('@')[1]),
      `${email} のドメインが許可ドメインに入っていません`
    );
  }
});

test('許可ドメイン外は raise exception で拒否する', () => {
  assert.match(sql, /signup_domain <> all \(public\.signup_allowed_domains\(\)\)/);
  assert.match(sql, /raise exception/);
});

test('public.users に行があるアカウントは通す（社外デモ用の締め出し防止）', () => {
  assert.match(sql, /not exists\s*\(\s*select 1\s*from public\.users u/);
});

test('何度流しても壊れないよう create or replace で書いてある', () => {
  const created = [...sql.matchAll(/^create (or replace )?function public\.(\w+)/gm)];

  assert.deepEqual(
    created.map((m) => m[2]),
    ['signup_allowed_domains', 'handle_new_user']
  );
  assert.ok(created.every((m) => m[1]), 'create or replace になっていない関数があります');
});

test('フロント側にはドメインチェックを足さない（APIを直接叩けば迂回されるため）', () => {
  const login = readFileSync(join(ROOT, 'src', 'login.js'), 'utf8');

  for (const domain of allowedDomains(sql)) {
    assert.ok(!login.includes(domain), `src/login.js に ${domain} の判定が入っています`);
  }
});
