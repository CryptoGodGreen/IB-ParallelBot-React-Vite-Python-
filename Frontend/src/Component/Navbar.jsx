import { NavLink, useNavigate } from "react-router-dom";
import logo from "../assets/logo.jpg";
import toast from "react-hot-toast";
import { useContext, useState, useRef, useEffect } from "react";
import { AuthContext } from "../context/AuthContext";
import { FaUserCircle } from "react-icons/fa";

function Navbar() {
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
    <nav className="flex justify-between items-center p-4 bg-slate-800 text-white shadow-md">
      {/* Logo */}
      <div className="text-xl font-bold">
        <NavLink to="/">
          <img
            src={logo}
            alt="Logo"
            className="h-12 rounded-sm hover:scale-105 transition-transform duration-200"
          />
        </NavLink>
      </div>

      {/* Right side */}
      <div className="flex items-center gap-4">
        {!isAuthenticated ? (
          <NavLink
            to="/login"
            className="bg-blue-600 px-4 py-2 rounded-lg hover:bg-blue-500 transition-colors"
          >
            Login
          </NavLink>
        ) : (
          <div className="relative" ref={dropdownRef}>
            {/* Profile Icon */}
            <button
              onClick={() => setDropdownOpen(!dropdownOpen)}
              className="flex items-center focus:outline-none"
            >
              <FaUserCircle className="text-3xl cursor-pointer text-gray-300 hover:text-blue-500 transition-colors" />
            </button>

            {/* Dropdown */}
            {dropdownOpen && (
              <div className="absolute right-0 mt-3 w-52 bg-white text-gray-800 rounded-xl shadow-lg border border-gray-200 transition-all duration-200 ease-in-out transform origin-top scale-95 animate-fadeIn">
                <NavLink
                  to="/profile"
                  className={({ isActive }) =>
                    `block px-4 py-3 transition-colors ${
                      isActive
                        ? "bg-blue-100 text-blue-600 font-medium"
                        : "hover:bg-blue-50 hover:text-blue-600"
                    }`
                  }
                  onClick={() => setDropdownOpen(false)}
                >
                  Profile
                </NavLink>

                <NavLink
                  to="/change-password"
                  className={({ isActive }) =>
                    `block px-4 py-3 transition-colors ${
                      isActive
                        ? "bg-blue-100 text-blue-600 font-medium"
                        : "hover:bg-blue-50 hover:text-blue-600"
                    }`
                  }
                  onClick={() => setDropdownOpen(false)}
                >
                  Change Password
                </NavLink>

                <button
                  onClick={handleLogout}
                  className="w-full text-left px-4 py-3 bg-red-50 hover:bg-red-100 text-red-600 font-medium transition-colors"
                >
                  Logout
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </nav>
  );
}

export default Navbar;
