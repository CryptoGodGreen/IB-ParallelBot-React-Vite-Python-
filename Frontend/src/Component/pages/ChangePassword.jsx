// src/pages/ChangePassword.jsx
import axios from "axios";
import { useState, useRef, forwardRef, useImperativeHandle } from "react";
import toast from "react-hot-toast";
import { useNavigate } from "react-router-dom";
import { FaEye, FaEyeSlash } from "react-icons/fa";

/** ---------- Stable child component (module scope) ---------- */
const PasswordField = forwardRef(function PasswordField(
  { id, label, value, onChange, show, setShow, error, loading },
  ref
) {
  const inputRef = useRef(null);

  // Expose focus method to parent (optional, handy for validation)
  useImperativeHandle(ref, () => ({
    focus: () => inputRef.current?.focus({ preventScroll: true }),
  }));

  const toggle = () => {
    // Toggle visibility
    setShow((p) => ({ ...p, [id]: !p[id] }));
    // Re-focus + restore caret after type flip
    requestAnimationFrame(() => {
      if (!inputRef.current) return;
      inputRef.current.focus({ preventScroll: true });
      const len = inputRef.current.value.length;
      try {
        inputRef.current.setSelectionRange(len, len);
      } catch {}
    });
  };

  return (
    <div>
      <label htmlFor={id} className="block text-sm text-slate-300 mb-1">
        {label}
      </label>
      <div className="relative">
        <input
          ref={inputRef}
          id={id}
          name={id}
          autoComplete={id === "new" ? "new-password" : "current-password"}
          type={show ? "text" : "password"}
          value={value}
          onChange={onChange}
          disabled={loading}
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          onKeyDownCapture={(e) => e.stopPropagation()} // shield from global shortcuts
          className="w-full px-3 py-2 rounded-xl bg-slate-900/60 border border-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-500 placeholder-slate-500"
          placeholder={label}
        />
        <button
          type="button"
          aria-label={show ? "Hide password" : "Show password"}
          onMouseDown={(e) => e.preventDefault()} // don't steal focus
          onClick={toggle}
          className={`absolute right-3 top-1/2 -translate-y-1/2 text-slate-300 transition-opacity ${
            value ? "opacity-100" : "opacity-0 pointer-events-none"
          }`}
          tabIndex={-1}
        >
          {show ? <FaEyeSlash /> : <FaEye />}
        </button>
      </div>
      {error && <p className="text-red-400 text-xs mt-1">{error}</p>}
    </div>
  );
});
/** ---------- end child ---------- */

export default function ChangePassword() {
  const [oldPassword, setOldPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");

  const [errors, setErrors] = useState({});
  const [showPassword, setShowPassword] = useState({
    old: false,
    new: false,
    confirm: false,
  });
  const [loading, setLoading] = useState(false);

  const navigate = useNavigate();

  const oldRef = useRef(null);
  const newRef = useRef(null);
  const confirmRef = useRef(null);

  const passwordRegex =
    /^(?=.*[A-Za-z])(?=.*\d)(?=.*[!@#$%^&*()_\-+=\[\]{};':"\\|,.<>\/?]).{6,}$/;

  const validateForm = () => {
    const next = {};
    const { oldPassword, newPassword, confirmPassword } = values;

    if (!oldPassword) next.oldPassword = "Old password is required";
    if (!newPassword) next.newPassword = "New password is required";
    else if (!passwordRegex.test(newPassword))
      next.newPassword =
        "Min 6 chars, include a letter, number & special character";
    if (!confirmPassword) next.confirmPassword = "Confirm password is required";
    else if (confirmPassword !== newPassword)
      next.confirmPassword = "Passwords do not match";

    setErrors(next);
    // Focus first error field
    if (next.oldPassword) oldRef.current?.focus();
    else if (next.newPassword) newRef.current?.focus();
    else if (next.confirmPassword) confirmRef.current?.focus();

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
        {
          old_password: values.oldPassword,
          new_password: values.newPassword,
        },
        {
          headers: { Authorization: `Bearer ${localStorage.getItem("token")}` },
        }
      );

      toast.success(response.data.message || "Password changed successfully!");
      setTimeout(() => navigate("/profile"), 800);
    } catch (error) {
      console.error(error);
      if (error.response) {
        toast.error(
          error.response.data.message ||
            "Failed to change password. Try again."
        );
        if (error.response.status === 401) {
          localStorage.removeItem("token");
          toast.error("Session expired. Please login again.");
          navigate("/login");
        }
      } else if (error.request) {
        toast.error("No response from server. Check your connection.");
      } else {
        toast.error("Something went wrong. Try again.");
      }
    } finally {
      setLoading(false);
    }
  };

  const onFieldChange =
    (setter, key) =>
    (e) => {
      setter(e.target.value);
      if (errors[key]) setErrors((prev) => ({ ...prev, [key]: "" }));
    };

  return (
    <div className="min-h-[calc(100vh-4rem)] grid place-items-center p-4">
      <form onSubmit={handleSubmit} className="card w-full max-w-md p-6 space-y-4">
        <div>
          <h2 className="text-2xl font-bold">Change Password</h2>
          <p className="text-sm text-slate-400">
            Keep your account secure with a strong password.
          </p>
        </div>

        <PasswordField
          ref={oldRef}
          id="old"
          label="Old Password"
          value={oldPassword}
          onChange={onFieldChange(setOldPassword, "oldPassword")}
          show={showPassword.old}
          setShow={setShowPassword}
          error={errors.oldPassword}
          loading={loading}
        />
        <PasswordField
          ref={newRef}
          id="new"
          label="New Password"
          value={newPassword}
          onChange={onFieldChange(setNewPassword, "newPassword")}
          show={showPassword.new}
          setShow={setShowPassword}
          error={errors.newPassword}
          loading={loading}
        />
        <PasswordField
          ref={confirmRef}
          id="confirm"
          label="Confirm New Password"
          value={confirmPassword}
          onChange={onFieldChange(setConfirmPassword, "confirmPassword")}
          show={showPassword.confirm}
          setShow={setShowPassword}
          error={errors.confirmPassword}
          loading={loading}
        />

        <button
          type="submit"
          disabled={loading}
          className={`w-full inline-flex items-center justify-center py-2 rounded-xl font-semibold ${
            loading
              ? "bg-blue-500/60 cursor-not-allowed"
              : "bg-blue-600 hover:bg-blue-500"
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
                <circle
                  className="opacity-25"
                  cx="12"
                  cy="12"
                  r="10"
                  stroke="currentColor"
                  strokeWidth="4"
                ></circle>
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
