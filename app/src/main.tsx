import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import "leaflet/dist/leaflet.css";
import "./styles/tokens.css";
import "./styles/app.css";
import "./styles/screens.css";

import App from "./App";

// Dev-only: ?geo=lat,lng stubs the browser's geolocation so the distance and
// "you are here" paths can be exercised without a real fix -- a desktop
// browser at a venue often refuses, and this app is mostly used on a phone.
if (import.meta.env.DEV) {
  const q = new URLSearchParams(location.search).get("geo");
  if (q) {
    const [lat, lng] = q.split(",").map(Number);
    if (Number.isFinite(lat) && Number.isFinite(lng)) {
      const coords = { latitude: lat, longitude: lng, accuracy: 40 };
      Object.defineProperty(navigator, "geolocation", {
        configurable: true,
        value: {
          watchPosition: (ok: PositionCallback) => {
            ok({ coords, timestamp: Date.now() } as GeolocationPosition);
            return 1;
          },
          clearWatch: () => {},
          getCurrentPosition: (ok: PositionCallback) =>
            ok({ coords, timestamp: Date.now() } as GeolocationPosition),
        },
      });
      (window as unknown as Record<string, boolean>).__SS_FAKE_GEO__ = true;
    }
  }
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
