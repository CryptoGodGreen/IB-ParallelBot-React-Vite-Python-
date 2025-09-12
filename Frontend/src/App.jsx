import { BrowserRouter as Router, Routes, Route, Navigate, useLocation } from "react-router-dom";
import Navbar from "./Component/Navbar";
import Login from "./Component/pages/Login";
import Profile from "./Component/pages/Profile";
import ChangePassword from "./Component/pages/ChangePassword";
import TradingViewWidget from "./Component/pages/TradingView";
import Sidebar from "./Component/Sidebar";
import { Toaster } from "react-hot-toast";
import { AuthProvider, AuthContext } from "./context/AuthContext";
import { useContext, useState } from "react";

const ProtectedRoute = ({ children }) => {
  const { isAuthenticated, loading } = useContext(AuthContext);

  if (loading) {
    return <div className="flex items-center justify-center h-screen">Loading...</div>;
  }

  return isAuthenticated ? children : <Navigate to="/login" replace />;
};


function DashboardLayout() {
  const [isOpen, setIsOpen] = useState(true);
  const toggleSidebar = () => setIsOpen(!isOpen);

  const location = useLocation();

  // ✅ Pages jisme sidebar hide karna hai
  const hideSidebarRoutes = ["/profile", "/change-password"];
  const shouldHideSidebar = hideSidebarRoutes.includes(location.pathname);

  return (
    <div className="flex h-screen bg-gray-50">
      {/* Sidebar show only if allowed */}
      {!shouldHideSidebar && (
        <Sidebar isOpen={isOpen} toggleSidebar={toggleSidebar} />
      )}

      {/* Main Content */}
      <div className="flex-1 p-4 overflow-auto">
        {!isOpen && !shouldHideSidebar && (
          <button
            onClick={toggleSidebar}
            className="mb-4 px-4 py-2 border rounded-md shadow-sm bg-white hover:bg-gray-100"
          >
            ☰ Menu
          </button>
        )}
        <Routes>
          <Route path="/" element={<TradingViewWidget />} />
          <Route path="/profile" element={<Profile />} />
          <Route path="/change-password" element={<ChangePassword />} />
          <Route path="/stock/:symbol" element={<TradingViewWidget />} />
        </Routes>
      </div>
    </div>
  );
}



function App() {
  return (
    <AuthProvider>
      <Toaster position="top-right" reverseOrder={false} />
      <Router>
        <Navbar />
        <Routes>
          {/* Login Page (accessible without auth) */}
          <Route path="/login" element={<Login />} />

          {/* Protected Dashboard */}
          <Route
            path="/*"
            element={
              <ProtectedRoute>
                <DashboardLayout />
              </ProtectedRoute>
            }
          />

          {/* Unknown routes redirect to login */}
          <Route path="*" element={<Navigate to="/login" replace />} />
        </Routes>
      </Router>
    </AuthProvider>
  );
}

export default App;
