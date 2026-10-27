import { useEffect, useRef, useState } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { IconMapPin } from "./Icons";

// Configure default marker icons cleanly for Vite bundler
delete L.Icon.Default.prototype._getIconUrl;

const defaultBlueIcon = L.divIcon({
  className: "custom-leaflet-marker blue-marker",
  html: `
    <div style="
      background-color: #2563eb;
      color: #ffffff;
      width: 32px;
      height: 32px;
      border-radius: 50% 50% 50% 0;
      transform: rotate(-45deg);
      display: flex;
      align-items: center;
      justify-content: center;
      border: 2px solid #ffffff;
      box-shadow: 0 3px 8px rgba(0,0,0,0.25);
    ">
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#ffffff" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="transform: rotate(45deg);">
        <path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z" />
        <circle cx="12" cy="10" r="3" />
      </svg>
    </div>
  `,
  iconSize: [32, 32],
  iconAnchor: [16, 32],
  popupAnchor: [0, -32],
});

const activeTrackingIcon = L.divIcon({
  className: "custom-leaflet-marker tracking-marker",
  html: `
    <div style="position: relative; width: 36px; height: 36px;">
      <div style="
        position: absolute;
        inset: -4px;
        background-color: rgba(22, 163, 74, 0.35);
        border-radius: 50%;
        animation: pulse-ring 2s cubic-bezier(0.455, 0.03, 0.515, 0.955) infinite;
      "></div>
      <div style="
        background-color: #16a34a;
        color: #ffffff;
        width: 36px;
        height: 36px;
        border-radius: 50% 50% 50% 0;
        transform: rotate(-45deg);
        display: flex;
        align-items: center;
        justify-content: center;
        border: 2px solid #ffffff;
        box-shadow: 0 3px 8px rgba(22,163,74,0.4);
      ">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#ffffff" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" style="transform: rotate(45deg);">
          <circle cx="12" cy="12" r="2" fill="#ffffff" />
          <path d="M16.2 7.8a6 6 0 0 1 0 8.5m-8.4 0a6 6 0 0 1 0-8.5" />
          <path d="M19.1 4.9a10 10 0 0 1 0 14.2m-14.2 0a10 10 0 0 1 0-14.2" />
        </svg>
      </div>
    </div>
  `,
  iconSize: [36, 36],
  iconAnchor: [18, 36],
  popupAnchor: [0, -36],
});

export default function AttendanceMap({
  employees = [],
  filterLabel = "",
  tileUrl = "https://tile.openstreetmap.org/{z}/{x}/{y}.png",
  attribution = '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap</a> contributors',
  height = 420,
}) {
  const mapContainerRef = useRef(null);
  const mapInstanceRef = useRef(null);
  const markersLayerRef = useRef(null);

  const [tileError, setTileError] = useState(false);
  const [selectedEmployee, setSelectedEmployee] = useState(null);

  // Filter employees with valid coordinates (either live tracking or punch location)
  const locatableEmployees = employees.filter((emp) => {
    const hasLive = emp.isTrackingActive && emp.liveTracking?.lastLocation?.latitude !== undefined;
    const hasPunchIn = emp.checkInLocation?.latitude !== undefined;
    const hasPunchOut = emp.checkOutLocation?.latitude !== undefined;
    return hasLive || hasPunchIn || hasPunchOut;
  });

  // Initialize Map
  useEffect(() => {
    if (!mapContainerRef.current) return;

    if (!mapInstanceRef.current) {
      // Default center: India/Central or fallback
      const map = L.map(mapContainerRef.current, {
        center: [20.5937, 78.9629],
        zoom: 5,
        attributionControl: true,
      });

      const tileLayer = L.tileLayer(tileUrl, {
        attribution,
        maxZoom: 19,
      });

      tileLayer.on("tileerror", () => {
        setTileError(true);
      });

      tileLayer.addTo(map);

      const markersGroup = L.featureGroup().addTo(map);
      markersLayerRef.current = markersGroup;
      mapInstanceRef.current = map;
    }

    return () => {
      if (mapInstanceRef.current) {
        mapInstanceRef.current.remove();
        mapInstanceRef.current = null;
        markersLayerRef.current = null;
      }
    };
  }, [tileUrl, attribution]);

  // Update Markers when locatableEmployees changes
  useEffect(() => {
    const map = mapInstanceRef.current;
    const markersGroup = markersLayerRef.current;
    if (!map || !markersGroup) return;

    markersGroup.clearLayers();

    if (locatableEmployees.length === 0) {
      map.setView([20.5937, 78.9629], 4);
      return;
    }

    const bounds = L.latLngBounds([]);

    locatableEmployees.forEach((emp) => {
      // Choose coordinate: live tracking first, then punch-in location
      const isLive = Boolean(emp.isTrackingActive && emp.liveTracking?.lastLocation);
      const coordSource = isLive
        ? emp.liveTracking.lastLocation
        : emp.checkInLocation || emp.checkOutLocation;

      if (!coordSource || typeof coordSource.latitude !== "number" || typeof coordSource.longitude !== "number") {
        return;
      }

      const latLng = [coordSource.latitude, coordSource.longitude];
      bounds.extend(latLng);

      const icon = isLive ? activeTrackingIcon : defaultBlueIcon;
      const marker = L.marker(latLng, { icon });

      // Build popup content
      const popupHtml = `
        <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; font-size: 13px; line-height: 1.4; color: #18181b; min-width: 220px; padding: 2px;">
          <div style="font-weight: 700; font-size: 14.5px; margin-bottom: 2px; color: #09090b;">
            ${emp.fullName}
          </div>
          <div style="color: #71717a; font-size: 12px; margin-bottom: 8px;">
            ${emp.employeeCode} • ${emp.department || "General"}
          </div>

          <div style="display: inline-block; padding: 3px 8px; border-radius: 6px; font-size: 11px; font-weight: 700; margin-bottom: 8px; background: ${
            isLive ? "#dcfce7; color: #15803d;" : emp.attendanceStatus === "CHECKED_IN" ? "#e0f2fe; color: #0369a1;" : "#f4f4f5; color: #52525b;"
          }">
            ${isLive ? "● LIVE TRACKING ACTIVE" : emp.attendanceStatus}
          </div>

          ${
            emp.checkInTime
              ? `<div style="font-size: 12px; margin-bottom: 4px;">
                  <strong style="color: #3f3f46;">Punch In:</strong> ${new Date(emp.checkInTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  ${coordSource.accuracy ? `<span style="color: #71717a;">(±${Math.round(coordSource.accuracy)}m)</span>` : ""}
                </div>`
              : ""
          }

          ${
            emp.checkOutTime
              ? `<div style="font-size: 12px; margin-bottom: 4px;">
                  <strong style="color: #3f3f46;">Punch Out:</strong> ${new Date(emp.checkOutTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                </div>`
              : ""
          }

          ${
            isLive && coordSource.capturedAt
              ? `<div style="font-size: 11.5px; color: #16a34a; margin-top: 6px; border-top: 1px solid #f4f4f5; padding-top: 4px;">
                  Updated ${new Date(coordSource.capturedAt).toLocaleTimeString()}
                </div>`
              : ""
          }
        </div>
      `;

      marker.bindPopup(popupHtml);
      marker.on("click", () => {
        setSelectedEmployee(emp);
      });

      markersGroup.addLayer(marker);
    });

    if (bounds.isValid()) {
      map.fitBounds(bounds, { padding: [40, 40], maxZoom: 15 });
    }
  }, [locatableEmployees]);

  return (
    <div
      style={{
        position: "relative",
        borderRadius: 14,
        overflow: "hidden",
        border: "1px solid #e4e4e7",
        background: "#f4f4f5",
        boxShadow: "0 1px 3px rgba(0,0,0,0.05)",
      }}
    >
      <div
        ref={mapContainerRef}
        style={{
          width: "100%",
          height: `${height}px`,
          zIndex: 1,
        }}
      />

      {tileError && (
        <div
          style={{
            position: "absolute",
            top: 12,
            right: 12,
            zIndex: 1000,
            background: "#fffbeb",
            color: "#92400e",
            border: "1px solid #fde68a",
            padding: "8px 12px",
            borderRadius: 8,
            fontSize: 12,
            boxShadow: "0 2px 6px rgba(0,0,0,0.1)",
          }}
        >
          Map tile network delay. Attendance data remains fully functional.
        </div>
      )}

      {locatableEmployees.length === 0 && (
        <div
          style={{
            position: "absolute",
            top: "50%",
            left: "50%",
            transform: "translate(-50%, -50%)",
            zIndex: 500,
            background: "rgba(255, 255, 255, 0.96)",
            backdropFilter: "blur(6px)",
            border: "1px solid #e4e4e7",
            borderRadius: 12,
            padding: "20px 28px",
            textAlign: "center",
            boxShadow: "0 4px 16px rgba(0,0,0,0.08)",
            maxWidth: 380,
            pointerEvents: "none",
          }}
        >
          <div
            style={{
              width: 48,
              height: 48,
              borderRadius: "50%",
              background: "#eff6ff",
              color: "#2563eb",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              margin: "0 auto 12px",
              border: "1px solid #dbeafe",
            }}
          >
            <IconMapPin size={24} />
          </div>
          <div style={{ fontWeight: 700, fontSize: 14, color: "#09090b", marginBottom: 4 }}>
            No Location Data Available
          </div>
          <div style={{ fontSize: 12, color: "#71717a", lineHeight: 1.5 }}>
            {filterLabel
              ? `No punch locations recorded for employees in "${filterLabel}".`
              : "No location data available."}
          </div>
        </div>
      )}

      {/* Legend & Stats Overlay */}
      <div
        style={{
          position: "absolute",
          bottom: 12,
          left: 12,
          zIndex: 1000,
          background: "rgba(255, 255, 255, 0.95)",
          backdropFilter: "blur(4px)",
          border: "1px solid #e4e4e7",
          padding: "8px 14px",
          borderRadius: 8,
          fontSize: 12,
          display: "flex",
          gap: 16,
          boxShadow: "0 2px 6px rgba(0,0,0,0.08)",
          flexWrap: "wrap",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <span style={{ display: "inline-block", width: 10, height: 10, borderRadius: "50%", background: "#2563eb" }}></span>
          <span style={{ fontWeight: 600, color: "#18181b" }}>Punch Location</span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <span style={{ display: "inline-block", width: 10, height: 10, borderRadius: "50%", background: "#16a34a" }}></span>
          <span style={{ fontWeight: 600, color: "#18181b" }}>Live Tracking Active</span>
        </div>
        <div style={{ color: "#71717a" }}>
          {filterLabel && (
            <span style={{ fontWeight: 600, color: "#2563eb", marginRight: 6 }}>
              [{filterLabel}]
            </span>
          )}
          Showing {locatableEmployees.length} of {employees.length} employees on map
        </div>
      </div>
    </div>
  );
}
