import "leaflet/dist/leaflet.css";
import React, { lazy, Suspense } from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter, NavLink, Route, Routes } from "react-router-dom";
import { useConfig } from "./hooks";
import DonatePage from "./pages/Donate";
import DonationPage from "./pages/DonationPage";
import "./styles.css";

// AG Grid is heavy, so the grid pages load on demand.
const LedgerPage = lazy(() => import("./pages/Ledger"));
const OperatorPage = lazy(() => import("./pages/Operator"));
const NetworkPage = lazy(() => import("./pages/Network"));
const FarmersPage = lazy(() => import("./pages/Farmers"));
const ShopPage = lazy(() => import("./pages/Shop"));


function Shell() {
  const cfg = useConfig();
  return (
    <>
      {cfg?.simulated && (
        <div className="banner">
          Simulation mode: PayPal sandbox keys are not set, so payments are simulated. Add keys to <code>.env</code> for real sandbox transactions.
        </div>
      )}
      <header className="topbar">
        <NavLink to="/" className="brand">
          <svg viewBox="0 0 32 32" width="28" height="28" aria-hidden>
            <circle cx="16" cy="16" r="15" fill="var(--green)" />
            <path d="M16 25V12M16 16c-4 0-6-3-6-6 4 0 6 2 6 6zm0 3c4 0 6-3 6-6-4 0-6 2-6 6z" stroke="var(--gold)" strokeWidth="2" fill="none" strokeLinecap="round" />
          </svg>
          Plantago
        </NavLink>
        <nav>
          <NavLink to="/" end>Give</NavLink>
          <NavLink to="/network">Network</NavLink>
          <NavLink to="/farmers">Farmers</NavLink>
          <NavLink to="/ledger">Public ledger</NavLink>
          <NavLink to="/operator">Operator</NavLink>
        </nav>
      </header>
      <main>
        <Suspense fallback={<p className="page muted">Loading…</p>}>
        <Routes>
          <Route path="/" element={<DonatePage />} />
          <Route path="/d/:id" element={<DonationPage />} />
          <Route path="/network" element={<NetworkPage />} />
          <Route path="/farmers" element={<FarmersPage />} />
          <Route path="/farmers/:id" element={<FarmersPage />} />
          <Route path="/farmers/:id/shop" element={<ShopPage />} />
          <Route path="/ledger" element={<LedgerPage />} />
          <Route path="/operator" element={<OperatorPage />} />
          <Route path="*" element={<p className="page">Page not found.</p>} />
        </Routes>
        </Suspense>
      </main>
      <footer className="footer">
        Demo for the PayPal AI Hackathon. Payments use the PayPal sandbox; grower names are fictional and deliveries are simulated.
      </footer>
    </>
  );
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <BrowserRouter>
      <Shell />
    </BrowserRouter>
  </React.StrictMode>,
);
