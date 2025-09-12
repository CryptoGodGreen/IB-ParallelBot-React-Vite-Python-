import axios from "axios";
import { useState } from "react";
import toast from "react-hot-toast";
import { useNavigate } from "react-router-dom";
import { FaEye, FaEyeSlash } from "react-icons/fa";
 
// Single-file updated ChangePassword component
// Key behaviors:
// - Eye toggle button is ALWAYS present in the DOM (prevents double-icon glitch),
//   but it's visually hidden when the field is empty using opacity + pointer-events.
// - Validation runs only on submit.
// - Per-field error clearing on change.
// - Loading spinner inside the submit button.
 
export default function ChangePassword() {
  const [oldPassword, setOldPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
 
  const [errors, setErrors] = useState({});
  const [showPassword, setShowPassword] = useState({ old: false, new: false, confirm: false });
  const [loading, setLoading] = useState(false);
 
  const navigate = useNavigate();
 
  const passwordRegex = /^(?=.*[A-Za-z])(?=.*\d)(?=.*[!@#$%^&*()_\-+=\[\]{};':"\\|,.<>\/?]).{6,}$/;
 
  const validateForm = () => {
    const next = {};
    if (!oldPassword) next.oldPassword = "Old password is required";
    if (!newPassword) next.newPassword = "New password is required";
    else if (!passwordRegex.test(newPassword))
      next.newPassword = "Password must be at least 6 chars, include a letter, number & special character";
    if (!confirmPassword) next.confirmPassword = "Confirm password is required";
    else if (confirmPassword !== newPassword) next.confirmPassword = "Passwords do not match";
 
    setErrors(next);
    return Object.keys(next).length === 0;
  };
 
  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!validateForm()) {
      toast.error("Please fix the errors");
      return;
    }
 
    setLoading(true);
    try {
      const response = await axios.post(
        `${import.meta.env.VITE_API_URL}/users/change-password`,
        { old_password: oldPassword, new_password: newPassword },
        {
          headers: { Authorization: `Bearer ${localStorage.getItem("token")}` },
          withCredentials: true,
        }
      );
 
      toast.success(response.data.message || "Password changed successfully!");
      setTimeout(() => navigate("/profile"), 1200);
    } catch (error) {
      console.error(error);
      if (error.response) {
        toast.error(error.response.data.message || "Failed to change password. Please try again.");
        if (error.response.status === 401) {
          localStorage.removeItem("token");
          toast.error("Session expired. Please login again.");
          navigate("/login");
        }
      } else if (error.request) {
        toast.error("No response from server. Please check your connection.");
      } else {
        toast.error("Something went wrong. Please try again.");
      }
    } finally {
      setLoading(false);
    }
  };
 
  // Clear a specific error when user starts typing again
  const clearError = (key) => {
    if (!errors[key]) return;
    setErrors((prev) => ({ ...prev, [key]: "" }));
  };
 
  // Reusable PasswordField component inside the same file
  function PasswordField({ id, label, value, onChange, show, toggleShow, errorKey }) {
    // errorKey should be one of: 'oldPassword' | 'newPassword' | 'confirmPassword'
    return (
      <div className="mb-4">
        <div className="relative">
          <input
            id={id}
            name={id}
            autoComplete={id === "new" ? "new-password" : "current-password"}
            type={show ? "text" : "password"}
            placeholder={label}
            value={value}
            onChange={(e) => {
              onChange(e.target.value);
              clearError(errorKey);
            }}
            disabled={loading}
            className="w-full p-2 border rounded pr-10 outline-none focus:ring-1 focus:ring-blue-300"
          />
 
          {/*
            The toggle button is ALWAYS in the DOM to avoid mount/unmount glitches
            but visually hidden when the field is empty using opacity + pointer-events.
          */}
          <button
            type="button"
            aria-label={show ? "Hide password" : "Show password"}
            onClick={toggleShow}
            className={`absolute right-3 top-1/2 -translate-y-1/2 text-gray-600 transition-opacity duration-150 ease-in-out ${
              value ? "opacity-100 pointer-events-auto" : "opacity-0 pointer-events-none"
            }`}
          >
            {show ? <FaEyeSlash /> : <FaEye />}
          </button>
        </div>
 
        {errors[errorKey] && (
          <p className="text-red-500 text-sm mt-1">{errors[errorKey]}</p>
        )}
      </div>
    );
  }
 
  return (
    <div className="flex justify-center items-center min-h-screen bg-gray-50 p-4">
      <form onSubmit={handleSubmit} className="bg-white p-6 rounded-lg shadow-lg w-full max-w-md">
        <h2 className="text-2xl mb-4 font-bold">Change Password</h2>
 
        <PasswordField
          id="old"
          label="Old Password"
          value={oldPassword}
          onChange={setOldPassword}
          show={showPassword.old}
          toggleShow={() => setShowPassword((p) => ({ ...p, old: !p.old }))}
          errorKey="oldPassword"
        />
 
        <PasswordField
          id="new"
          label="New Password"
          value={newPassword}
          onChange={setNewPassword}
          show={showPassword.new}
          toggleShow={() => setShowPassword((p) => ({ ...p, new: !p.new }))}
          errorKey="newPassword"
        />
 
        <PasswordField
          id="confirm"
          label="Confirm New Password"
          value={confirmPassword}
          onChange={setConfirmPassword}
          show={showPassword.confirm}
          toggleShow={() => setShowPassword((p) => ({ ...p, confirm: !p.confirm }))}
          errorKey="confirmPassword"
        />
 
        <button
          type="submit"
          disabled={loading}
          className={`w-full inline-flex items-center justify-center text-white py-2 rounded transition ${
            loading ? "bg-blue-400 cursor-not-allowed" : "bg-blue-500 hover:bg-blue-600"
          }`}
        >
          {loading ? (
            <>
              <svg
                className="animate-spin h-4 w-4 mr-2"
                xmlns="http://www.w3.org/2000/svg"
                fill="none"
                viewBox="0 0 24 24"
              >
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                <path
                  className="opacity-75"
                  fill="currentColor"
                  d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z"
                ></path>
              </svg>
              Updating...
            </>
          ) : (
            "Update Password"
          )}
        </button>
      </form>
    </div>
  );
}
 
 