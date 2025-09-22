import { useState } from "react";
import { Routes, Route, Navigate, useLocation } from "react-router-dom";
import Navbar from "./Component/Navbar";
import Sidebar from "./Component/Sidebar";
import Home from "./Component/pages/Home";
import Login from "./Component/pages/Login";
import Profile from "./Component/pages/Profile";
import ChangePassword from "./Component/pages/ChangePassword";
// import TradingViewWidget from "./Component/pages/TradingView";
import { AuthContext } from "./context/AuthContext";
import TradingViewWidget from "./Component/pages/TradingView";

export default function App() {
  const [isAuthenticated, setIsAuthenticated] = useState(
    Boolean(localStorage.getItem("token"))
  );
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);
  const location = useLocation();

  const toggleSidebar = () => {
    setIsSidebarOpen((prev) => {
      const next = !prev;
      // Trigger resize so layouts (e.g., charts) recalc during/after toggle
      try { window.dispatchEvent(new Event('resize')); } catch (_) {}
      setTimeout(() => { try { window.dispatchEvent(new Event('resize')); } catch (_) {} }, 16);
      setTimeout(() => { try { window.dispatchEvent(new Event('resize')); } catch (_) {} }, 320);
      return next;
    });
  };

  const bareRoutes = ["/login"]; 
  const isBare = bareRoutes.includes(location.pathname);

  return (
    <AuthContext.Provider value={{ isAuthenticated, setIsAuthenticated }}>
      <div className="min-h-screen bg-gradient-to-br from-slate-950 via-slate-900 to-slate-800 text-white">
        {!isBare && (
          <Navbar isSidebarOpen={isSidebarOpen} toggleSidebar={toggleSidebar} />
        )}
        <div className={`flex ${isBare ? "" : "pt-16"}`}>
          {!isBare && (
            <Sidebar isOpen={isSidebarOpen} toggleSidebar={toggleSidebar} />
          )}
          <main className={`flex-1 min-w-0 ${!isBare && isSidebarOpen ? "p-6" : "p-4"}`}>
            <Routes>
              <Route path="/" element={<Home />} />
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
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </main>
        </div>
      </div>
    </AuthContext.Provider>
  );
}
