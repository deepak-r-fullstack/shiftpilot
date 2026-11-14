import { Navigate, Route, Routes } from "react-router-dom";
import { AppLayout } from "components/layout/AppLayout";
import { DisplayToasts } from "components/display_components";
import { useSessionStore } from "utils/store/sessionStore";
import { WelcomeScreen } from "screens/welcome_screen";
import { ScheduleScreen } from "screens/schedule_screen";
import { ReviewScreen } from "screens/review_screen";

export const App = () => {
  const token = useSessionStore((state) => state.token);

  return (
    <>
      {token ? (
        <Routes>
          <Route element={<AppLayout />}>
            <Route path="/schedule" element={<ScheduleScreen />} />
            <Route path="/proposals/:id" element={<ReviewScreen />} />
            <Route path="*" element={<Navigate to="/schedule" replace />} />
          </Route>
        </Routes>
      ) : (
        <Routes>
          <Route path="*" element={<WelcomeScreen />} />
        </Routes>
      )}
      <DisplayToasts />
    </>
  );
};
