import { useNavigate } from "react-router-dom";
import { useContext, useRef, useState } from "react";
import toast from "react-hot-toast";
import axios from "axios";
// Keep your existing path if it's correct in your repo:
import { AuthContext } from "../../context/AuthContext";
import { FaEye, FaEyeSlash } from "react-icons/fa";

export default function Login() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPwd, setShowPwd] = useState(false);

  const pwdRef = useRef(null);
  const navigate = useNavigate();
  const { setIsAuthenticated } = useContext(AuthContext);

  const validateEmail = (value) => {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!value) return "Email is required";
    if (!emailRegex.test(value)) return "Invalid email format";
    return "";
  };

  const handleLogin = async (e) => {
    e.preventDefault();

    // Email validation
    const emailError = validateEmail(email);
    if (emailError) {
      toast.error(emailError);
      return;
    }

    // Password validation
    const passwordRegex =
      /^(?=.*[A-Za-z])(?=.*\d)(?=.*[!@#$%^&*()_\-+=\[\]{};':"\\|,.<>\/?]).{6,}$/;
    if (!passwordRegex.test(password)) {
      toast.error(
        "Password must be at least 6 characters and include 1 letter, 1 number, and 1 special character"
      );
      return;
    }

    try {
      const base_url = import.meta.env.VITE_API_URL;
      const response = await axios.post(`${base_url}/users/login`, {
        email,
        password,
      });

      if (response.data?.access_token) {
        localStorage.setItem("token", response.data.access_token);
        setIsAuthenticated(true);
        toast.success("Logged in successfully!");
        setTimeout(() => navigate("/"), 800);
      } else {
        toast.error("Login failed: No token received");
      }
    } catch (error) {
      console.error("Login error:", error);
      if (error.response) {
        toast.error(
          error.response.data?.detail ||
            "Invalid credentials. Please try again."
        );
      } else {
        toast.error("Something went wrong. Please try later.");
      }
    }
  };

  const togglePassword = () => {
    setShowPwd((v) => !v);
    requestAnimationFrame(() => {
      if (!pwdRef.current) return;
      pwdRef.current.focus({ preventScroll: true });
      const len = pwdRef.current.value.length;
      try {
        pwdRef.current.setSelectionRange(len, len);
      } catch {}
    });
  };

  return (
    <div className="min-h-screen grid place-items-center p-4 bg-gradient-to-br from-slate-950 via-slate-900 to-slate-800">
      <form onSubmit={handleLogin} className="card w-full max-w-md p-6">
        <h2 className="text-2xl font-bold">Welcome back</h2>
        <p className="text-slate-400 text-sm mb-4">Sign in to continue</p>

        <label className="block text-sm text-slate-300 mb-1">Email</label>
        <input
          type="email"
          placeholder="you@example.com"
          className="w-full px-3 py-2 mb-3 rounded-xl bg-slate-900/60 border border-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
        />

        <label className="block text-sm text-slate-300 mb-1">Password</label>
        <div className="relative mb-4">
          <input
            ref={pwdRef}
            type={showPwd ? "text" : "password"}
            placeholder="••••••••"
            className="w-full px-3 py-2 pr-10 rounded-xl bg-slate-900/60 border border-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            onKeyDownCapture={(e) => e.stopPropagation()}
          />
          <button
            type="button"
            aria-label={showPwd ? "Hide password" : "Show password"}
            onMouseDown={(e) => e.preventDefault()}
            onClick={togglePassword}
            className={`absolute right-3 top-1/2 -translate-y-1/2 text-slate-300 transition-opacity ${
              password ? "opacity-100" : "opacity-0 pointer-events-none"
            }`}
            tabIndex={-1}
          >
            {showPwd ? <FaEyeSlash /> : <FaEye />}
          </button>
        </div>

        <button
          type="submit"
          className="w-full py-2 rounded-xl bg-blue-600 hover:bg-blue-500 font-semibold"
        >
          Sign In
        </button>
      </form>
    </div>
  );
}
