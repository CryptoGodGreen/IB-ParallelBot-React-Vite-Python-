import { useState } from "react";
import { useNavigate } from "react-router-dom";
import axios from "axios";
import toast from "react-hot-toast";

export default function ChangePassword() {
  const navigate = useNavigate();

  const [values, setValues] = useState({
    oldPassword: "",
    newPassword: "",
    confirmPassword: "",
  });

  const [errors, setErrors] = useState({});
  const [loading, setLoading] = useState(false);

  const passwordRegex =
    /^(?=.*[A-Za-z])(?=.*\d)(?=.*[!@#$%^&*()_\-+=\[\]{};':"\\|,.<>\/?]).{6,}$/;

  const handleChange = (e) => {
    const { name, value } = e.target;
    setValues({ ...values, [name]: value });

    let error = "";

    if (name === "oldPassword" && !value) error = "Old password is required";

    if (name === "newPassword") {
      if (!value) error = "New password is required";
      else if (!passwordRegex.test(value))
        error =
          "Password must be at least 6 chars, include a letter, number & special character";
    }

    if (name === "confirmPassword") {
      if (!value) error = "Confirm password is required";
      else if (value !== values.newPassword) error = "Passwords do not match";
    }

    setErrors({ ...errors, [name]: error });
  };

  const validateForm = () => {
    const next = {};
    const { oldPassword, newPassword, confirmPassword } = values;

    if (!oldPassword) next.oldPassword = "Old password is required";
    if (!newPassword) next.newPassword = "New password is required";
    else if (!passwordRegex.test(newPassword))
      next.newPassword =
        "Password must be at least 6 chars, include a letter, number & special character";
    if (!confirmPassword) next.confirmPassword = "Confirm password is required";
    else if (confirmPassword !== newPassword)
      next.confirmPassword = "Passwords do not match";

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
        {
          old_password: values.oldPassword,
          new_password: values.newPassword,
        },
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
        toast.error(
          error.response.data.message || "Failed to change password. Please try again."
        );
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

  return (
    <div className="flex justify-center mt-12">
      <form
        onSubmit={handleSubmit}
        className="flex flex-col w-80 p-6 border border-gray-300 rounded-lg"
      >
        <h2 className="text-center text-xl font-semibold mb-6">Change Password</h2>

        {/* Old Password */}
        <label className="mb-1">Old Password</label>
        <div className="mb-3">
          <input
            type="password"
            name="oldPassword"
            value={values.oldPassword}
            onChange={handleChange}
            className="w-full px-3 py-2 border rounded"
          />
          {errors.oldPassword && (
            <p className="text-red-500 text-xs mt-1">{errors.oldPassword}</p>
          )}
        </div>

        {/* New Password */}
        <label className="mb-1">New Password</label>
        <div className="mb-3">
          <input
            type="password"
            name="newPassword"
            value={values.newPassword}
            onChange={handleChange}
            className="w-full px-3 py-2 border rounded"
          />
          {errors.newPassword && (
            <p className="text-red-500 text-xs mt-1">{errors.newPassword}</p>
          )}
        </div>

        {/* Confirm Password */}
        <label className="mb-1">Confirm Password</label>
        <div className="mb-4">
          <input
            type="password"
            name="confirmPassword"
            value={values.confirmPassword}
            onChange={handleChange}
            className="w-full px-3 py-2 border rounded"
          />
          {errors.confirmPassword && (
            <p className="text-red-500 text-xs mt-1">{errors.confirmPassword}</p>
          )}
        </div>

        <button
          type="submit"
          disabled={loading}
          className="py-2 bg-blue-500 text-white rounded hover:bg-blue-600 disabled:opacity-50"
        >
          {loading ? "Updating..." : "Update Password"}
        </button>
      </form>
    </div>
  );
}
