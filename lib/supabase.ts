import { createClient, type PostgrestError, type SupabaseClient } from "@supabase/supabase-js";
import type { DatabaseTables, DatabaseViews } from "@/utils/database.interfaces";

export type TableName = keyof DatabaseTables;
export type ViewName = keyof DatabaseViews;

export type TableRow<T extends TableName> = DatabaseTables[T];
export type ViewRow<T extends ViewName> = DatabaseViews[T];

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
    throw new Error(
        "Missing Supabase environment variables. Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY.",
    );
}

const globalForSupabase = globalThis as unknown as {
    supabase?: SupabaseClient;
};

export const supabase: SupabaseClient =
    globalForSupabase.supabase ?? createClient(supabaseUrl, supabaseAnonKey);

if (process.env.NODE_ENV !== "production") {
    globalForSupabase.supabase = supabase;
}

export function fromTable<T extends TableName>(table: T) {
    return supabase.from(table);
}

export function fromView<T extends ViewName>(view: T) {
    return supabase.from(view);
}

export async function selectAll<T extends TableName>(
    table: T,
): Promise<{ data: TableRow<T>[]; error: PostgrestError | null }> {
    const { data, error } = await supabase.from(table).select("*");
    return { data: (data ?? []) as TableRow<T>[], error };
}

export async function selectById<T extends TableName>(
    table: T,
    id: number,
): Promise<{ data: TableRow<T> | null; error: PostgrestError | null }> {
    const { data, error } = await supabase.from(table).select("*").eq("id", id).maybeSingle();
    return { data: (data as TableRow<T> | null) ?? null, error };
}

export async function insertRow<T extends TableName>(
    table: T,
    payload: Partial<Omit<TableRow<T>, "id">>,
): Promise<{ data: TableRow<T> | null; error: PostgrestError | null }> {
    const { data, error } = await supabase.from(table).insert(payload).select("*").maybeSingle();
    return { data: (data as TableRow<T> | null) ?? null, error };
}

export async function updateRowById<T extends TableName>(
    table: T,
    id: number,
    payload: Partial<Omit<TableRow<T>, "id">>,
): Promise<{ data: TableRow<T> | null; error: PostgrestError | null }> {
    const { data, error } = await supabase
        .from(table)
        .update(payload)
        .eq("id", id)
        .select("*")
        .maybeSingle();

    return { data: (data as TableRow<T> | null) ?? null, error };
}

export async function deleteRowById<T extends TableName>(
    table: T,
    id: number,
): Promise<{ success: boolean; error: PostgrestError | null }> {
    const { error } = await supabase.from(table).delete().eq("id", id);
    return { success: !error, error };
}

export async function selectAllFromView<T extends ViewName>(
    view: T,
): Promise<{ data: ViewRow<T>[]; error: PostgrestError | null }> {
    const { data, error } = await supabase.from(view).select("*");
    return { data: (data ?? []) as ViewRow<T>[], error };
}
