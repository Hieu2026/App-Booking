"use client";
import { createContext, useContext } from "react";
import type { AppContext } from "@/lib/types";

const Ctx = createContext<AppContext | null>(null);
export function ContextProvider({ value, children }: { value: AppContext; children: React.ReactNode }) {
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
export function useAppContext() {
  const v = useContext(Ctx);
  if (!v) throw new Error("Thiếu ContextProvider");
  return v;
}
