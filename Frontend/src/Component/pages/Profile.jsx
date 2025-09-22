import axios from "axios";
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";

export default function Profile() {
  const [profileData, setProfileData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [buttonLoading, setButtonLoading] = useState(false);

  const getProfile = async () => {
    const base_url = import.meta.env.VITE_API_URL;
    const token = localStorage.getItem("token");
    if (!token) { window.location.href = "/login"; return; }

    try {
      const response = await axios.get(`${base_url}/users/me`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (response.data) setProfileData(response.data);
    } catch (error) {
      console.error("Error fetching profile:", error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { getProfile(); }, []);

  const formatDate = (dateString) => {
    const d = new Date(dateString);
    return d.toLocaleDateString() + " " + d.toLocaleTimeString();
  };

  return (
    <div className="min-h-[calc(100vh-4rem)] grid place-items-center p-4">
      <div className="card w-full max-w-md p-6">
        <h2 className="text-2xl font-bold mb-4">Profile</h2>
        {loading ? (
          <div className="space-y-3 animate-pulse">
            {[...Array(4)].map((_, i) => (
              <div key={i} className="h-12 bg-slate-800 rounded-xl" />
            ))}
          </div>
        ) : (
          <>
            <div className="space-y-3">
              <div className="flex justify-between bg-slate-900/60 p-3 rounded-xl border border-slate-800">
                <span className="text-slate-400">Email</span>
                <span className="font-medium">{profileData?.email}</span>
              </div>
              <div className="flex justify-between bg-slate-900/60 p-3 rounded-xl border border-slate-800">
                <span className="text-slate-400">Role</span>
                <span className="font-medium">{profileData?.role}</span>
              </div>
              <div className="flex justify-between bg-slate-900/60 p-3 rounded-xl border border-slate-800">
                <span className="text-slate-400">Broker ID</span>
                <span className="font-medium">{profileData?.brokerId}</span>
              </div>
              <div className="flex justify-between bg-slate-900/60 p-3 rounded-xl border border-slate-800">
                <span className="text-slate-400">Created</span>
                <span className="font-medium">{profileData?.timestamp ? formatDate(profileData.timestamp) : "-"}</span>
              </div>
            </div>
            <Link
              to="/change-password"
              className={`mt-6 w-full block text-center py-3 rounded-xl font-semibold text-white ${
                buttonLoading ? "bg-blue-500/60 cursor-not-allowed" : "bg-blue-600 hover:bg-blue-500"
              }`}
              onClick={() => setButtonLoading(true)}
            >
              {buttonLoading ? "Loading..." : "Change Password"}
            </Link>
          </>
        )}
      </div>
    </div>
  );
}