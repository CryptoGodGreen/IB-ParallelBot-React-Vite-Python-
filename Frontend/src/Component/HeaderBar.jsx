import { NavLink } from "react-router-dom";
import "./HeaderBar.css";

export default function HeaderBar() {
  const navItems = [
    { path: "/", label: "Current Bots" },
    { path: "/all-bots", label: "All Bots" },
    { path: "/open-orders", label: "Open Orders" },
    { path: "/status", label: "Status" },
    { path: "/report", label: "Report" },
    { path: "/configuration", label: "Configuration" },
    { path: "/restart-processes", label: "Restart Processes" },
  ];

  return (
    <header className="header-bar">
      <nav className="header-nav">
        {navItems.map((item) => (
          <NavLink
            key={item.path}
            to={item.path}
            end={item.path === "/"}
            className={({ isActive }) =>
              `nav-item ${isActive ? "active" : ""}`
            }
          >
            {item.label}
          </NavLink>
        ))}
      </nav>
    </header>
  );
}

