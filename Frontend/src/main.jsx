import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import App from "./App.jsx";
import "./index.css";
import { Toaster } from "react-hot-toast";

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <BrowserRouter>
      <App />
      <Toaster position="top-center" gutter={8} toastOptions={{
        style: { background: "#0f172a", color: "#fff", border: "1px solid #1f2937" },
      }}/>
    </BrowserRouter>
  </React.StrictMode>
);