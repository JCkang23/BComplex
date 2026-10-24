import React from "react";
import { createRoot } from "react-dom/client";
import DashboardWorkspace from "./pages/DashboardWorkspace.jsx";
import LeaseWorkspace from "./pages/LeaseWorkspace.jsx";
import AuthWorkspace from "./pages/AuthWorkspace.jsx";
import PortalWorkspace from "./pages/PortalWorkspace.jsx";
import TenantWorkspace from "./pages/TenantWorkspace.jsx";
import "./styles.css";

const path = window.location.pathname.split("/").pop();
const authPages = new Set(["", "login", "register"]);
const landlordPages = new Set(["contracts", "payments", "messages", "profile", "account"]);
const tenantPages = new Set(["tDashboard", "tLease", "tPayments", "tMessages"]);
const Workspace = authPages.has(path)
    ? () => <AuthWorkspace mode={path || "home"} />
    : tenantPages.has(path)
      ? () => <TenantWorkspace section={path} />
      : landlordPages.has(path)
        ? () => <PortalWorkspace section={path} />
        : path === "dashboard"
          ? DashboardWorkspace
          : LeaseWorkspace;

createRoot(document.getElementById("root")).render(
    <React.StrictMode>
        <Workspace />
    </React.StrictMode>
);
