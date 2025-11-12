import { useState } from "react";
import { Routes, Route, Navigate, useLocation } from "react-router-dom";
import HeaderBar from "./components/layout/HeaderBar";
import Home from "./components/pages/Home";
import Login from "./components/pages/Login";
import Profile from "./components/pages/Profile";
import ChangePassword from "./components/pages/ChangePassword";
import TradingViewWidget from "./components/pages/TradingView";
import TradingDashboard from "./components/pages/TradingDashboard";
import CurrentBots from "./components/pages/CurrentBots";
import AllBots from "./components/pages/AllBots";
import OpenOrders from "./components/pages/OpenOrders";
import Status from "./components/pages/Status";
import Report from "./components/pages/Report";
import Configuration from "./components/pages/Configuration";
import RestartProcesses from "./components/pages/RestartProcesses";
import AuthExpiredModal from "./components/common/AuthExpiredModal";
import { useAuthExpired } from "./hooks/useAuthExpired";
import { AuthContext } from "./context/AuthContext";

export default function App() {
  const [isAuthenticated, setIsAuthenticated] = useState(
    Boolean(localStorage.getItem("token"))
  );
  const location = useLocation();
  const { isOpen: isAuthExpiredOpen, hide: hideAuthExpired } = useAuthExpired();

  const bareRoutes = ["/login"]; 
  const headerBarRoutes = ["/", "/current-bots", "/all-bots", "/open-orders", "/status", "/report", "/configuration", "/restart-processes"];
  const isBare = bareRoutes.includes(location.pathname);
  const hideSidebar = true; // Always hide sidebar - removed MARKETS panel
  const showHeaderBar = isAuthenticated && headerBarRoutes.includes(location.pathname);

  return (
    <AuthContext.Provider value={{ isAuthenticated, setIsAuthenticated }}>
      <div className="min-h-screen bg-gradient-to-br from-slate-950 via-slate-900 to-slate-800 text-white">
        {showHeaderBar && <HeaderBar />}
        <AuthExpiredModal isOpen={isAuthExpiredOpen} onClose={hideAuthExpired} />
        <div className={`flex ${isBare ? "" : showHeaderBar ? "pt-12" : "pt-0"}`}>
          <main className="flex-1 min-w-0 p-4">
            <Routes>
              <Route 
                path="/" 
                element={
                  isAuthenticated ? (
                    <div className="no-padding">
                      <TradingDashboard />
                    </div>
                  ) : <Navigate to="/login" replace />
                } 
              />
              <Route path="/login" element={<Login />} />
              <Route
                path="/profile"
                element={
                  isAuthenticated ? <Profile /> : <Navigate to="/login" replace />
                }
              />
              <Route
                path="/change-password"
                element={
                  isAuthenticated ? (
                    <ChangePassword />
                  ) : (
                    <Navigate to="/login" replace />
                  )
                }
              />
              <Route path="/stock/:symbol" element={<TradingViewWidget />} />
              <Route 
                path="/trading-dashboard" 
                element={
                  isAuthenticated ? (
                    <div className="no-padding">
                      <TradingDashboard />
                    </div>
                  ) : <Navigate to="/login" replace />
                } 
              />
              <Route
                path="/current-bots"
                element={
                  isAuthenticated ? <CurrentBots /> : <Navigate to="/login" replace />
                }
              />
              <Route
                path="/all-bots"
                element={
                  isAuthenticated ? <AllBots /> : <Navigate to="/login" replace />
                }
              />
              <Route
                path="/open-orders"
                element={
                  isAuthenticated ? <OpenOrders /> : <Navigate to="/login" replace />
                }
              />
              <Route
                path="/status"
                element={
                  isAuthenticated ? <Status /> : <Navigate to="/login" replace />
                }
              />
              <Route
                path="/report"
                element={
                  isAuthenticated ? <Report /> : <Navigate to="/login" replace />
                }
              />
              <Route
                path="/configuration"
                element={
                  isAuthenticated ? <Configuration /> : <Navigate to="/login" replace />
                }
              />
              <Route
                path="/restart-processes"
                element={
                  isAuthenticated ? <RestartProcesses /> : <Navigate to="/login" replace />
                }
              />
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </main>
        </div>
      </div>
    </AuthContext.Provider>
  );
}
