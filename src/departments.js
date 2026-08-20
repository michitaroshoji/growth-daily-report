// ============================================================
// 部署（departments）
//   管理者画面とプロフィール設定の両方から使う、取得まわりの共通処理。
//   閲覧はログイン済みなら全員できる（RLS: departments_select）。
// ============================================================
import { supabase } from './supabase.js';

// 部署の一覧。取れなければ空配列を返し、呼び出し側は「未所属だけ」で動かす
export async function fetchDepartments() {
  const { data, error } = await supabase
    .from('departments')
    .select('id, name')
    .order('name');

  if (error) {
    console.error('部署一覧の取得に失敗しました', error);
    return [];
  }
  return data || [];
}

// <select> に「未所属」＋部署名を並べる。selectedId が無ければ未所属を選ぶ
export function fillDepartmentSelect(select, departments, selectedId) {
  select.innerHTML = '';

  const none = document.createElement('option');
  none.value = '';
  none.textContent = '未所属';
  select.appendChild(none);

  departments.forEach((row) => {
    const option = document.createElement('option');
    option.value = row.id;
    option.textContent = row.name;
    select.appendChild(option);
  });

  select.value = selectedId || '';
}
