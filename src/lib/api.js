import { supabase, isSupabaseConfigured } from "./supabaseClient";

export async function fetchRaces(dateStr) {
  if (!isSupabaseConfigured) throw new Error("Supabaseが設定されていません(.env.localを確認してください)");

  const { data, error } = await supabase.functions.invoke("nar-races", {
    body: { date: dateStr },
  });

  if (error) throw new Error(error.message || "取得に失敗しました");
  if (data?.error) throw new Error(data.error);
  return data.races;
}
