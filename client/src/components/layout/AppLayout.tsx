import { useState } from "react";
import { Link, Outlet, useNavigate } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { CalendarClock, LogOut, RotateCcw } from "lucide-react";
import { DisplayButton } from "components/display_components";
import { sessionService } from "utils/services/api_services/shiftpilot_service";
import { getErrorMessage } from "utils/services/api_services/apiClient";
import { useSessionStore } from "utils/store/sessionStore";
import { showToast } from "utils/store/toastStore";

// One top bar: the product, who is signed in, and the visitor's private demo copy.
export const AppLayout = () => {
  const { coordinator, sandbox, endSession } = useSessionStore();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [resetting, setResetting] = useState(false);

  const resetDemo = async () => {
    if (!window.confirm("Put your demo agency back to the start? Your plans and changes will be removed.")) return;
    setResetting(true);
    try {
      await sessionService.reset();
      await queryClient.invalidateQueries();
      showToast("Your demo agency is back to the start.");
      navigate("/schedule");
    } catch (error) {
      showToast(getErrorMessage(error), "error");
    } finally {
      setResetting(false);
    }
  };

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-30 border-b border-line bg-sheet/95 backdrop-blur">
        <div className="mx-auto flex max-w-[1400px] flex-wrap items-center justify-between gap-3 px-4 py-3 sm:px-6">
          <Link to="/schedule" className="flex items-center gap-2">
            <CalendarClock className="h-6 w-6 text-brand" aria-hidden />
            <span className="text-lg font-semibold tracking-tight">ShiftPilot</span>
            <span className="hidden text-sm text-ink-faint sm:inline">Sunrise Home Care (demo)</span>
          </Link>
          <div className="flex items-center gap-3">
            {coordinator && (
              <p className="hidden text-right text-sm leading-tight md:block">
                <span className="font-semibold">{coordinator.name}</span>
                <span className="block text-xs text-ink-faint">
                  {coordinator.role} · {sandbox?.label}
                </span>
              </p>
            )}
            <DisplayButton variant="ghost" onClick={resetDemo} loading={resetting} icon={<RotateCcw className="h-4 w-4" />}>
              Reset demo
            </DisplayButton>
            <DisplayButton variant="ghost" onClick={endSession} icon={<LogOut className="h-4 w-4" />} aria-label="End demo">
              <span className="hidden sm:inline">End demo</span>
            </DisplayButton>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-[1400px] px-4 py-6 sm:px-6">
        <Outlet />
      </main>
    </div>
  );
};
