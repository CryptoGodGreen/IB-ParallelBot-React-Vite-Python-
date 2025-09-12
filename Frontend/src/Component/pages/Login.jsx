import { useNavigate } from "react-router-dom";
import { useContext, useState } from "react";
import toast from "react-hot-toast";
import axios from "axios";
import { AuthContext } from "../../context/AuthContext";

function Login() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [errors, setErrors] = useState({});
  const navigate = useNavigate();
  const { setIsAuthenticated } = useContext(AuthContext);

  const validateEmail = (value) => {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!value) return "Email is required";
    if (!emailRegex.test(value)) return "Invalid email format";
    return "";
  };

  const validatePassword = (value) => {
    const passwordRegex =
      /^(?=.*[A-Za-z])(?=.*\d)(?=.*[!@#$%^&*()_\-+=\[\]{};':"\\|,.<>/?]).{6,}$/;
    if (!value) return "Password is required";
    if (!passwordRegex.test(value))
      return "Password must be at least 6 chars, include 1 letter, 1 number & 1 special character";
    return "";
  };

  const handleEmailChange = (e) => {
    const value = e.target.value;
    setEmail(value);
    setErrors((prev) => ({ ...prev, email: validateEmail(value) }));
  };

  const handlePasswordChange = (e) => {
    const value = e.target.value;
    setPassword(value);
    setErrors((prev) => ({ ...prev, password: validatePassword(value) }));
  };

  const handleLogin = async (e) => {
    e.preventDefault();

    // Final validation before submit
    const emailError = validateEmail(email);
    const passwordError = validatePassword(password);
    if (emailError || passwordError) {
      setErrors({ email: emailError, password: passwordError });
      toast.error("Please fix the errors");
      return;
    }

    try {
      const base_url = import.meta.env.VITE_API_URL;
      const response = await axios.post(`${base_url}/users/login`, { email, password });

      if (response.data?.access_token) {
        localStorage.setItem("token", response.data.access_token);
        setIsAuthenticated(true);
        toast.success("Logged In successfully!");
        setTimeout(() => navigate("/"), 1500);
      } else {
        toast.error("Login failed: No token received");
      }
    } catch (error) {
      console.error("Login error:", error);
      if (error.response) {
        toast.error(
          error.response.data?.detail || "Invalid credentials. Please try again."
        );
      } else {
        toast.error("Something went wrong. Please try later.");
      }
    }
  };

  return (
    <div className="flex justify-center items-center h-screen">
      <form
        onSubmit={handleLogin}
        className="bg-white p-6 rounded-xl shadow-md w-80"
      >
        <h2 className="text-2xl mb-4 font-bold">Login</h2>

        {/* Email */}
        <div className="mb-3">
          <input
            type="email"
            placeholder="Email"
            className="w-full p-2 border rounded"
            value={email}
            onChange={handleEmailChange}
          />
          {errors.email && (
            <p className="text-red-500 text-xs mt-1">{errors.email}</p>
          )}
        </div>

        {/* Password */}
        <div className="mb-3">
          <input
            type="password"
            placeholder="Password"
            className="w-full p-2 border rounded"
            value={password}
            onChange={handlePasswordChange}
          />
          {errors.password && (
            <p className="text-red-500 text-xs mt-1">{errors.password}</p>
          )}
        </div>

        <button
          type="submit"
          className="w-full bg-blue-500 text-white py-2 rounded"
        >
          Login
        </button>
      </form>
    </div>
  );
}

export default Login;
