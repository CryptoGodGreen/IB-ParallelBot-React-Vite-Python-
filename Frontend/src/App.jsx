// src/App.jsx
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { useState, useEffect } from 'react';
import { Toaster } from 'react-hot-toast';
import { AuthContext } from './context/AuthContext';
import Navbar from './Component/Navbar';
import Sidebar from './Component/Sidebar';
import Home from './Component/pages/Home';
import Stock from './Component/pages/Stock';
import Login from './Component/pages/Login';
import Profile from './Component/pages/Profile';
import ChangePassword from './Component/pages/ChangePassword';

function App() {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);

  useEffect(() => {
    const token = localStorage.getItem('token');
    setIsAuthenticated(!!token);
  }, []);

  const toggleSidebar = () => setIsSidebarOpen((prev) => !prev);

  return (
    <AuthContext.Provider value={{ isAuthenticated, setIsAuthenticated }}>
      <BrowserRouter>
        <div className="min-h-screen bg-slate-950 text-slate-100">
          <Toaster position="top-right" />
          
          <Navbar isSidebarOpen={isSidebarOpen} toggleSidebar={toggleSidebar} />
          
          <div className="pt-16 flex">
            <Sidebar isOpen={isSidebarOpen} toggleSidebar={toggleSidebar} />
            
            <main className="flex-1 transition-all duration-300">
              <Routes>
                <Route path="/" element={<Home />} />
                <Route path="/stock/:symbol" element={<Stock />} />
                <Route path="/login" element={<Login />} />
                <Route 
                  path="/profile" 
                  element={isAuthenticated ? <Profile /> : <Navigate to="/login" />} 
                />
                <Route 
                  path="/change-password" 
                  element={isAuthenticated ? <ChangePassword /> : <Navigate to="/login" />} 
                />
              </Routes>
            </main>
          </div>
        </div>
      </BrowserRouter>
    </AuthContext.Provider>
  );
}

export default App;