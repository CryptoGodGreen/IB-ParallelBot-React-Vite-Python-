import { useNavigate } from "react-router-dom";
import { useContext, useState } from "react";
import toast from "react-hot-toast";
import axios from "axios";
import { AuthContext } from "../../context/AuthContext";

function Login() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const navigate = useNavigate();
   const { setIsAuthenticated } = useContext(AuthContext);

  const handleLogin = async (e) => {
    e.preventDefault();
    const passwordRegex =
      /^(?=.*[A-Za-z])(?=.*\d)(?=.*[!@#$%^&*()_\-+=\[\]{};':"\\|,.<>/?]).{6,}$/;

    if (!passwordRegex.test(password)) {
      toast.error(
        "Password must be at least 6 characters and include 1 letter, 1 number, and 1 special character"
      );
      return;
    }

    try {
      if (!email || !password) {
        toast.error("Please enter email and password");
        return;
      }

      const base_url = import.meta.env.VITE_API_URL;

      const response = await axios.post(`${base_url}/users/login`, {
        email,
        password,
      });
      if (response.data?.access_token) {
        localStorage.setItem("token", response.data.access_token);
        setIsAuthenticated(true);
        toast.success("Logged In successfully!");

        setTimeout(() => {
          navigate("/");
        }, 1500);
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
    <div className="flex justify-center items-center h-screen ">
      <form
        onSubmit={handleLogin}
        className="bg-white p-6 rounded-xl shadow-md w-80"
      >
        <h2 className="text-2xl mb-4 font-bold">Login</h2>
        <input
          type="email"
          placeholder="Email"
          className="w-full p-2 mb-3 border"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
        />
        <input
          type="password"
          placeholder="Password"
          className="w-full p-2 mb-3 border"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
        />
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
