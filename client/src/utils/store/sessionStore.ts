import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { Coordinator, SandboxInfo } from "utils/types";

interface SessionState {
  token: string | null;
  coordinator: Coordinator | null;
  sandbox: SandboxInfo | null;
  setSession: (token: string, coordinator: Coordinator, sandbox: SandboxInfo) => void;
  endSession: () => void;
}

// localStorage can throw (private windows, blocked storage). Fall back to memory so the demo still works.
const safeStorage = createJSONStorage(() => {
  try {
    const probe = "__shiftpilot_probe__";
    window.localStorage.setItem(probe, "1");
    window.localStorage.removeItem(probe);
    return window.localStorage;
  } catch {
    const memory = new Map<string, string>();
    return {
      getItem: (key: string) => memory.get(key) ?? null,
      setItem: (key: string, value: string) => void memory.set(key, value),
      removeItem: (key: string) => void memory.delete(key),
    };
  }
});

export const useSessionStore = create<SessionState>()(
  persist(
    (set) => ({
      token: null,
      coordinator: null,
      sandbox: null,
      setSession: (token, coordinator, sandbox) => set({ token, coordinator, sandbox }),
      endSession: () => set({ token: null, coordinator: null, sandbox: null }),
    }),
    { name: "shiftpilot-session", storage: safeStorage }
  )
);
