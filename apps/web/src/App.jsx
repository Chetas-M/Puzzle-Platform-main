import { Navigate, Route, Routes } from "react-router-dom";
import { useAuth } from "./context/AuthContext";
import ProtectedRoute from "./components/ProtectedRoute";
import LoginPage from "./pages/LoginPage";
import PuzzlePage from "./pages/PuzzlePage";
import NoChromeChallengePage from "./pages/NoChromeChallengePage";
import AdminPage from "./pages/AdminPage";
import LeaderboardPage from "./pages/LeaderboardPage";

function RootRedirect() {
  const { isAuthenticated, isAdmin } = useAuth();
  if (!isAuthenticated) {
    return <Navigate to="/login" replace />;
  }

  return <Navigate to={isAdmin ? "/admin" : "/puzzles"} replace />;
}

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<RootRedirect />} />
      <Route path="/login" element={<LoginPage />} />
      <Route path="/leaderboard" element={<LeaderboardPage />} />
      <Route
        path="/puzzles"
        element={
          <ProtectedRoute participantOnly>
            <PuzzlePage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/admin"
        element={
          <ProtectedRoute adminOnly>
            <AdminPage />
          </ProtectedRoute>
        }
      />
      <Route path="/challenge/:slug" element={<NoChromeChallengePage />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
