import "server-only";
import { cache } from "react";
import { createClient } from "@/lib/supabase/server";
import { parseError, type AppError } from "@/lib/errors";
import type { AppContext } from "@/lib/types";

export async function rpc<T>(name: string, args: Record<string, unknown> = {}): Promise<{ data: T | null; error: AppError | null }> {
  try {
    const supabase = await createClient();
    const { data, error } = await supabase.rpc(name, args);
    if (error) return { data: null, error: parseError(error) };
    return { data: data as T, error: null };
  } catch (e: any) {
    return { data: null, error: parseError({ message: e?.message ?? "network" }) };
  }
}

export const getContext = cache(() => rpc<AppContext>("get_context"));
