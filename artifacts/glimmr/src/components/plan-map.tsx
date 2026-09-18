import { useEffect, useRef, useState } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { RouteVisual } from '@/components/glimmr-ui';
import type { PlanStep } from '@/types/glimmr';

const TILE_URL = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
const TILE_ATTRIBUTION =
  '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';

/**
 * Real stop map for a plan: OpenStreetMap tiles with numbered stop markers
 * joined in visit order. Decorative RouteVisual remains the fallback when
 * the map cannot render (no coordinates, or a tile/lifecycle failure).
 */
export function PlanMap({ steps }: { steps: PlanStep[] }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const container = containerRef.current;
    if (!container || steps.length === 0) return;
    let map: L.Map | null = null;
    try {
      const points = steps.map((step) => ({ lat: step.place.lat, lng: step.place.lng }));
      if (points.some((point) => !Number.isFinite(point.lat) || !Number.isFinite(point.lng))) {
        setFailed(true);
        return;
      }
      map = L.map(container, { scrollWheelZoom: false }).setView([points[0].lat, points[0].lng], 15);
      L.tileLayer(TILE_URL, { maxZoom: 19, attribution: TILE_ATTRIBUTION }).addTo(map);
      const latLngs = points.map((point) => L.latLng(point.lat, point.lng));
      steps.forEach((step, index) => {
        L.marker(latLngs[index], {
          icon: L.divIcon({
            className: 'plan-map-pin',
            html: `<span>${index + 1}</span>`,
            iconSize: [26, 26],
            iconAnchor: [13, 13],
          }),
        })
          .bindPopup(`<strong>${index + 1}. ${step.place.name}</strong><br />${step.arrival} · ${step.durationMinutes} min here`)
          .addTo(map as L.Map);
      });
      if (latLngs.length > 1) {
        L.polyline(latLngs, { color: '#3B82F6', weight: 3, opacity: 0.85 }).addTo(map as L.Map);
      }
      map.fitBounds(L.latLngBounds(latLngs).pad(0.25));
    } catch {
      setFailed(true);
    }
    return () => {
      map?.remove();
      map = null;
    };
  }, [steps]);

  if (failed || steps.length === 0) return <RouteVisual small />;
  return (
    <div
      ref={containerRef}
      className="plan-map"
      data-testid="plan-map"
      role="img"
      aria-label={`Map of ${steps.length} planned stops`}
    />
  );
}
