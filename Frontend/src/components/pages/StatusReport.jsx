import { useState, useEffect } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import Status from "./Status";
import Report from "./Report";
import "./StatusReport.css";

const StatusReport = () => {
  const location = useLocation();
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState("status");

  // Set active tab based on current route
  useEffect(() => {
    if (location.pathname === "/report") {
      setActiveTab("report");
    } else {
      setActiveTab("status");
    }
  }, [location.pathname]);

  const handleTabChange = (tab) => {
    setActiveTab(tab);
    // Update URL when tab changes
    if (tab === "report") {
      navigate("/report", { replace: true });
    } else {
      navigate("/status", { replace: true });
    }
  };

  return (
    <div className="page-container">
      <div className="status-report-header">
        <h1 className="page-title">Status & Report</h1>
        <p className="page-description">System status and trading performance</p>
      </div>
      
      <div className="status-report-tabs">
        <button
          className={`tab-button ${activeTab === "status" ? "active" : ""}`}
          onClick={() => handleTabChange("status")}
        >
          Status
        </button>
        <button
          className={`tab-button ${activeTab === "report" ? "active" : ""}`}
          onClick={() => handleTabChange("report")}
        >
          Report
        </button>
      </div>

      <div className="status-report-content">
        {activeTab === "status" && <Status />}
        {activeTab === "report" && <Report />}
      </div>
    </div>
  );
};

export default StatusReport;

