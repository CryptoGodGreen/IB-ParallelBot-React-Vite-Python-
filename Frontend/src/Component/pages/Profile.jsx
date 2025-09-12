import axios from "axios";
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
 
function Profile() {
  const [profileData, setProfileData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [buttonLoading, setButtonLoading] = useState(false);
 
  const getProfile = async () => {
    const base_url = import.meta.env.VITE_API_URL;
    const token = localStorage.getItem("token");
 
    if (!token) {
      window.location.href = "/login";
      return;
    }
 
    try {
      const response = await axios.get(`${base_url}/users/me`, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });
 
      if (response.data) {
        setProfileData(response.data);
      }
    } catch (error) {
      console.error("Error fetching profile:", error);
    } finally {
      setLoading(false);
    }
  };
 
  useEffect(() => {
    getProfile();
  }, []);
 
  const formatDate = (dateString) => {
    return new Date(dateString).toLocaleDateString() + " " + new Date(dateString).toLocaleTimeString();
  };
 
  return (
<div className="flex justify-center items-center min-h-screen  p-4">
<div className="bg-white p-6 rounded-2xl shadow-lg w-full max-w-md">
<h2 className="text-3xl font-bold mb-6 text-center text-gray-800">Profile</h2>
 
        {loading ? (
<div className="flex justify-center py-10">
<div className="loader ease-linear rounded-full border-4 border-t-4 border-gray-200 h-12 w-12"></div>
</div>
        ) : (
<>
<div className="space-y-3">
<div className="flex justify-between bg-gray-50 p-3 rounded shadow-sm">
<span className="font-semibold text-gray-600">Email:</span>
<span className="text-gray-800">{profileData?.email}</span>
</div>
<div className="flex justify-between bg-gray-50 p-3 rounded shadow-sm">
<span className="font-semibold text-gray-600">Role:</span>
<span className="text-gray-800">{profileData?.role}</span>
</div>
<div className="flex justify-between bg-gray-50 p-3 rounded shadow-sm">
<span className="font-semibold text-gray-600">Broker ID:</span>
<span className="text-gray-800">{profileData?.brokerId}</span>
</div>
<div className="flex justify-between bg-gray-50 p-3 rounded shadow-sm">
<span className="font-semibold text-gray-600">Created At:</span>
<span className="text-gray-800">{profileData?.timestamp ? formatDate(profileData.timestamp) : "-"}</span>
</div>
</div>
 
            <Link
              to="/change-password"
              className={`mt-6 w-full block text-center py-3 rounded-lg font-semibold text-white transition ${
                buttonLoading ? "bg-blue-400 cursor-not-allowed" : "bg-blue-500 hover:bg-blue-600"
              }`}
              onClick={() => setButtonLoading(true)}
>
              {buttonLoading ? "Loading..." : "Change Password"}
</Link>
</>
        )}
</div>
 
      {/* Spinner styles */}
<style>{`
        .loader {
          border-top-color: #3498db;
          animation: spin 1s linear infinite;
        }
        @keyframes spin {
          0% { transform: rotate(0deg);}
          100% { transform: rotate(360deg);}
        }
      `}</style>
</div>
  );
}
 
export default Profile;