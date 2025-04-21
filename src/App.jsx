import React from 'react';
import LandingPage from './pages/LandingPage';
import { Analytics } from "@vercel/analytics/react";

function App() {
  return (
    <div className="App">
      <LandingPage />
      <Analytics />
    </div>
  );
}

export default App; 