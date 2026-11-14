import axios, { AxiosError } from "axios";
import { useSessionStore } from "utils/store/sessionStore";

// One axios instance for the whole app. In development Vite forwards /api to the server.
export const API_BASE = import.meta.env.VITE_API_URL || "/api";

export const apiClient = axios.create({ baseURL: API_BASE, timeout: 60_000 });

apiClient.interceptors.request.use((config) => {
  const token = useSessionStore.getState().token;
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

apiClient.interceptors.response.use(
  (response) => response,
  (error: AxiosError) => {
    // The demo session ended (24 hours): go back to the welcome screen.
    if (error.response?.status === 401 && useSessionStore.getState().token) {
      useSessionStore.getState().endSession();
    }
    return Promise.reject(error);
  }
);

// Turns any error into one sentence a person can act on.
export function getErrorMessage(error: unknown): string {
  if (axios.isAxiosError(error)) {
    const message = (error.response?.data as { message?: string } | undefined)?.message;
    if (message) return message;
    if (!error.response) return "Cannot reach ShiftPilot. Check your connection, then try again.";
  }
  if (error instanceof Error && error.message) return error.message;
  return "Something went wrong. Please try again.";
}

export function getRuleResults(error: unknown) {
  if (!axios.isAxiosError(error)) return null;
  const details = (error.response?.data as { details?: { ruleResults?: { rule: string; passed: boolean; message: string }[] } })?.details;
  return details?.ruleResults ?? null;
}
