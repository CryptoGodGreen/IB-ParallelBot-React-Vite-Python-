import { NavLink, useNavigate } from "react-router-dom";
import logo from "../assets/logo.jpg";
import toast from "react-hot-toast";
import { useContext, useRef, useEffect, useState } from "react";
import { AuthContext } from "../context/AuthContext";
import { FaUserCircle, FaBars, FaChevronDown } from "react-icons/fa";
import SearchAutocomplete from "./SearchAutocomplete";

export default function Navbar({ isSidebarOpen, toggleSidebar }) {
  const navigate = useNavigate();
  const { isAuthenticated, setIsAuthenticated } = useContext(AuthContext);
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const dropdownRef = useRef(null);

  const handleLogout = () => {
    localStorage.removeItem("token");
    setIsAuthenticated(false);
    toast.success("Logged out successfully!");
    navigate("/login");
  };

  useEffect(() => {
    const handleClickOutside = (event) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target)) {
        setDropdownOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  return (
    <nav className="fixed top-0 inset-x-0 z-40 shadow-xl">
      <div className="relative">
        {/* Gradient bar */}
        <div className="absolute inset-0 bg-gradient-to-r from-blue-600 via-indigo-600 to-fuchsia-600 opacity-80 blur-md"></div>
        <div className="relative backdrop-blur-sm bg-slate-900/70 border-b border-slate-800">
          <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between gap-4">
            {/* Left: Menu + Logo */}
            <div className="flex items-center gap-3">
              <button
                onClick={toggleSidebar}
                className="p-2 rounded-xl bg-slate-800/80 hover:bg-slate-700 border border-slate-700"
                aria-label="Toggle sidebar"
              >
                <FaBars />
              </button>
              <NavLink to="/" className="flex items-center gap-2">
                <img src={logo} alt="Logo" className="h-9 w-9 rounded-md shadow" />
                <span className="hidden sm:inline font-extrabold tracking-tight text-white">PB Terminal</span>
              </NavLink>
            </div>

            {/* Center: Search */}
            <div className="flex-1 flex justify-center">
              <SearchAutocomplete onPicked={() => { /* navigate handled inside */ }} />
            </div>

            {/* Right: Auth */}
            <div className="flex items-center gap-2">
              {!isAuthenticated ? (
                <NavLink
                  to="/login"
                  className="px-4 py-2 rounded-xl bg-white/10 hover:bg-white/20 border border-white/20 transition"
                >
                  Login
                </NavLink>
              ) : (
                <div className="relative" ref={dropdownRef}>
                  <button
                    onClick={() => setDropdownOpen((p) => !p)}
                    className="flex items-center gap-2 px-3 py-2 rounded-xl bg-white/10 hover:bg-white/20 border border-white/20"
                  >
                    <FaUserCircle className="text-2xl" />
                    <FaChevronDown className="opacity-70" />
                  </button>

                  {dropdownOpen && (
                    <div className="absolute right-0 mt-2 w-56 card p-2">
                      <NavLink
                        to="/profile"
                        onClick={() => setDropdownOpen(false)}
                        className={({ isActive }) =>
                          `block px-3 py-2 rounded-lg ${
                            isActive ? "bg-blue-600/20 text-blue-300" : "hover:bg-slate-800"
                          }`
                        }
                      >
                        Profile
                      </NavLink>
                      <NavLink
                        to="/change-password"
                        onClick={() => setDropdownOpen(false)}
                        className={({ isActive }) =>
                          `block px-3 py-2 rounded-lg ${
                            isActive ? "bg-blue-600/20 text-blue-300" : "hover:bg-slate-800"
                          }`
                        }
                      >
                        Change Password
                      </NavLink>
                      <button
                        onClick={handleLogout}
                        className="w-full text-left px-3 py-2 rounded-lg bg-red-600/10 text-red-300 hover:bg-red-600/20"
                      >
                        Logout
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </nav>
  );
}