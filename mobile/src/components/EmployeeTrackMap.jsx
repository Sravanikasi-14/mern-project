import { useEffect, useMemo, useRef } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";

const TILE_URL = "https://tile.openstreetmap.org/{z}/{x}/{y}.png";
const ATTRIBUTION =
  '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap</a>';

function haversineMeters(a, b) {
  const toRad = (d) => (d * Math.PI) / 180;
  const R = 6371000;
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

export function distanceLabel(points) {
  if (!Array.isArray(points) || points.length < 2) return null;
  let meters = 0;
  for (let i = 1; i < points.length; i += 1) {
    meters += haversineMeters(points[i - 1], points[i]);
  }
  if (!Number.isFinite(meters) || meters <= 0) return null;
  if (meters < 1000) return `${Math.round(meters)} m`;
  return `${(meters / 1000).toFixed(2)} km`;
}

function currentIcon(isLive) {
  const color = isLive ? "#0f382a" : "#2563eb";
  return L.divIcon({
    className: "hr-track-marker",
    html: `<span class="hr-track-pin${isLive ? " is-live" : ""}" style="--pin:${color}"></span>`,
    iconSize: [28, 28],
    iconAnchor: [14, 28],
  });
}

function pointIcon() {
  return L.divIcon({
    className: "hr-track-dot-wrap",
    html: `<span class="hr-track-dot"></span>`,
    iconSize: [12, 12],
    iconAnchor: [6, 6],
  });
}

/**
 * Renders only the provided track points for one employee.
 * Clears all layers when points / employeeKey change.
 */
export default function EmployeeTrackMap({
  points = [],
  employeeKey = "",
  isLive = false,
  height = 320,
  emptyMessage = "No GPS points for this employee and date.",
}) {
  const containerRef = useRef(null);
  const mapRef = useRef(null);
  const layerRef = useRef(null);

  const validPoints = useMemo(
    () =>
      (points || []).filter(
        (p) =>
          p &&
          Number.isFinite(Number(p.lat)) &&
          Number.isFinite(Number(p.lng)) &&
          Math.abs(Number(p.lat)) <= 90 &&
          Math.abs(Number(p.lng)) <= 180
      ).map((p) => ({
        lat: Number(p.lat),
        lng: Number(p.lng),
        label: p.label || "",
        at: p.at || null,
        kind: p.kind || "point",
      })),
    [points]
  );

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return undefined;
    const map = L.map(containerRef.current, {
      center: [20.5937, 78.9629],
      zoom: 5,
      zoomControl: false,
      attributionControl: true,
    });
    L.tileLayer(TILE_URL, { attribution: ATTRIBUTION, maxZoom: 19 }).addTo(map);
    L.control.zoom({ position: "topright" }).addTo(map);
    layerRef.current = L.featureGroup().addTo(map);
    mapRef.current = map;
    return () => {
      map.remove();
      mapRef.current = null;
      layerRef.current = null;
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    const group = layerRef.current;
    if (!map || !group) return;

    group.clearLayers();

    if (validPoints.length === 0) {
      map.setView([20.5937, 78.9629], 4);
      return;
    }

    const latLngs = validPoints.map((p) => [p.lat, p.lng]);

    if (latLngs.length >= 2) {
      L.polyline(latLngs, {
        color: "#0f382a",
        weight: 4,
        opacity: 0.85,
        lineJoin: "round",
        lineCap: "round",
      }).addTo(group);
    }

    validPoints.forEach((p, index) => {
      const isLatest = index === validPoints.length - 1;
      const marker = L.marker([p.lat, p.lng], {
        icon: isLatest ? currentIcon(isLive) : pointIcon(),
        zIndexOffset: isLatest ? 500 : 0,
      });
      const time =
        p.at && !Number.isNaN(new Date(p.at).getTime())
          ? new Date(p.at).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })
          : null;
      const lines = [p.label || (isLatest ? "Latest location" : "Route point"), time].filter(Boolean);
      marker.bindPopup(lines.join("<br/>"));
      marker.addTo(group);
    });

    const bounds = L.latLngBounds(latLngs);
    map.fitBounds(bounds.pad(0.35), { maxZoom: 16, animate: false });
  }, [validPoints, employeeKey, isLive]);

  return (
    <div className="hr-track-map-shell" style={{ height }}>
      <div ref={containerRef} className="hr-track-map" role="img" aria-label="Employee route map" />
      {validPoints.length === 0 ? (
        <div className="hr-track-map-empty">
          <p>{emptyMessage}</p>
        </div>
      ) : null}
    </div>
  );
}
