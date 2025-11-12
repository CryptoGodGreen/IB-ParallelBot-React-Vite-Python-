import { NavLink, useNavigate } from "react-router-dom";
import { useContext, useRef, useEffect, useState } from "react";
import { AuthContext } from "../../context/AuthContext";
import { FaUserCircle, FaChevronDown } from "react-icons/fa";
import toast from "react-hot-toast";
import logo from "../../assets/logo.jpg";
import "./HeaderBar.css";

export default function HeaderBar() {
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

  const navItems = [
    { path: "/current-bots", label: "Current Bots" },
    { path: "/all-bots", label: "All Bots" },
    { path: "/open-orders", label: "Open Orders" },
    { path: "/status", label: "Status" },
    { path: "/report", label: "Report" },
    { path: "/configuration", label: "Configuration" },
    { path: "/restart-processes", label: "Restart Processes" },
  ];

  return (
    <header className="header-bar">
      <div className="header-bar-container">
        {/* Left: Logo */}
        <div className="header-logo">
          <NavLink to="/" className="flex items-center gap-2">
            <img src={logo} alt="Logo" className="h-8 w-8 rounded-md shadow" />
            <span className="hidden sm:inline font-extrabold tracking-tight text-white">PB Terminal</span>
          </NavLink>
        </div>

        {/* Center: Navigation Items */}
        <nav className="header-nav">
          {navItems.map((item) => (
            <NavLink
              key={item.path}
              to={item.path}
              end={item.path === "/"}
              className={({ isActive }) =>
                `nav-item ${isActive ? "active" : ""}`
              }
            >
              {item.label}
            </NavLink>
          ))}
        </nav>

        {/* Right: User Dropdown */}
        <div className="header-user">
          {!isAuthenticated ? (
            <NavLink
              to="/login"
              className="px-4 py-2 rounded-xl bg-white/10 hover:bg-white/20 border border-white/20 transition text-sm"
            >
              Login
            </NavLink>
          ) : (
            <div className="relative" ref={dropdownRef}>
              <button
                onClick={() => setDropdownOpen((p) => !p)}
                className="flex items-center gap-2 px-3 py-2 rounded-xl bg-white/10 hover:bg-white/20 border border-white/20 transition"
              >
                <FaUserCircle className="text-xl" />
                <FaChevronDown className="opacity-70 text-sm" />
              </button>

              {dropdownOpen && (
                <div className="absolute right-0 mt-2 w-56 card p-2 z-50">
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
    </header>
  );
}

