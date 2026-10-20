import { t } from "./locale";
import React, { useEffect, useRef, useState } from "react";
import { z } from "zod";
import { reactive, useStateField } from "@whale-ui/react";
import { define, Feedback, Glyph } from "./common";

export type MarkerInfo = { label: string; lat: number; lng: number; category?: string; icon?: string };
export const MapMarker = define("MapMarker", { label: z.string(), lat: z.number(), lng: z.number(), category: z.string().optional(), icon: z.string().optional() }, "Map location with label, latitude, longitude and optional category/emoji.", p => <span className="whale-map-location">{p.icon ?? "📍"} {p.label}</span>);
export function markerData(value: any): MarkerInfo | null {
  const p = value?.props ?? value;
  return p && typeof p.label === "string" && typeof p.lat === "number" && Number.isFinite(p.lat) && Math.abs(p.lat) <= 90 && typeof p.lng === "number" && Number.isFinite(p.lng) && Math.abs(p.lng) <= 180 ? { label: p.label, lat: p.lat, lng: p.lng, category: p.category, icon: p.icon } : null;
}
// The host's existing route API publishes lat,lng pairs; GeoJSON requires lng,lat.
export const routeCoordinates = (points: [number, number][]) => points.filter(pair => Array.isArray(pair) && pair.length === 2 && pair.every(Number.isFinite)).map(([lat, lng]) => [lng, lat]);
const MAP_STYLE = "https://basemaps.cartocdn.com/gl/positron-gl-style/style.json";
function MapView(p: any) {
  const selected = useStateField("selected", p.selected), selectedRef = useRef(selected); selectedRef.current = selected;
  const host = useRef<HTMLDivElement>(null), mapRef = useRef<any>(null), [error, setError] = useState(""), [retry, setRetry] = useState(0);
  const [routeError, setRouteError] = useState(""), [route, setRoute] = useState<number[][] | null>(null);
  const routeRef = useRef(route); routeRef.current = route;
  const markers: MarkerInfo[] = p.markers.map(markerData).filter(Boolean);
  const key = JSON.stringify(markers), routeKey = JSON.stringify(markers.map(({ lat, lng }) => [lng, lat]));
  const clickMarker = (marker: MarkerInfo) => selectedRef.current.setValue(marker.label);
  useEffect(() => {
    if (!p.route || markers.length < 2) { setRoute(null); setRouteError(""); return; }
    const controller = new AbortController(); setRoute(null); setRouteError("");
    const load = async () => {
      try {
        const coords = markers.map(marker => `${marker.lng},${marker.lat}`).join(";");
        const response = await fetch(`/api/street-route?coords=${encodeURIComponent(coords)}`, { signal: controller.signal }), json = await response.json();
        if (!response.ok) throw new Error(json.error?.message ?? t("streetRouteUnavailable"));
        const points = routeCoordinates(Array.isArray(json.points) ? json.points : []);
        if (points.length < 2) throw new Error(t("noRoute"));
        if (!controller.signal.aborted) setRoute(points);
      } catch (problem) { if (!controller.signal.aborted) setRouteError(problem instanceof Error ? problem.message : t("streetRouteUnavailable")); }
    };
    void load(); return () => controller.abort();
  }, [p.route, routeKey, retry]);
  useEffect(() => {
    let cancelled = false, map: any, resize: ResizeObserver | undefined; const pins: any[] = [];
    if (!host.current || !markers.length) return;
    setError("");
    const mount = async () => {
      try {
        const lib = await import("maplibre-gl");
        if (cancelled || !host.current) return;
        const globals = globalThis as typeof globalThis & { __WHALE_MAP_WORKER_URL__?: string; __WHALE_OPENUI_MAP_WORKER_URL__?: string };
        const workerUrl = globals.__WHALE_MAP_WORKER_URL__ ?? globals.__WHALE_OPENUI_MAP_WORKER_URL__;
        if (workerUrl) lib.setWorkerUrl(workerUrl);
        map = new lib.Map({ container: host.current, style: MAP_STYLE, center: [markers[0].lng, markers[0].lat], zoom: markers.length === 1 ? 13 : 3, attributionControl: { compact: true } });
        mapRef.current = map;
        map.addControl(new lib.NavigationControl({ showCompass: false }), "top-right");
        map.on("error", (event: any) => { if (!cancelled) setError(event.error?.message ?? t("mapTilesUnavailable")); });
        map.on("load", () => {
          if (cancelled) return;
          const bounds = new lib.LngLatBounds();
          markers.forEach((marker, index) => {
            bounds.extend([marker.lng, marker.lat]);
            const button = document.createElement("button"); button.type = "button"; button.className = "whale-map-pin"; button.textContent = marker.icon ?? String(index + 1); button.title = marker.label; button.setAttribute("aria-label", marker.label); button.dataset.label = marker.label; button.dataset.selected = String(selectedRef.current.value === marker.label);
            button.addEventListener("click", () => { clickMarker(marker); map.flyTo({ center: [marker.lng, marker.lat], zoom: Math.max(map.getZoom(), 12) }); });
            pins.push(new lib.Marker({ element: button, anchor: "bottom" }).setLngLat([marker.lng, marker.lat]).addTo(map));
          });
          if (markers.length > 1) map.fitBounds(bounds, { padding: 48, maxZoom: 14, duration: 0 });
          updateRoute(map, routeRef.current);
        });
        if (typeof ResizeObserver !== "undefined") { resize = new ResizeObserver(() => map?.resize()); resize.observe(host.current); }
      } catch (problem) { if (!cancelled) setError(problem instanceof Error ? problem.message : t("mapFailed")); }
    };
    void mount();
    return () => { cancelled = true; resize?.disconnect(); pins.forEach(pin => pin.remove()); if (map) { if (mapRef.current === map) mapRef.current = null; map.remove(); } };
  }, [key, retry]);
  useEffect(() => { const map = mapRef.current; if (map?.isStyleLoaded()) updateRoute(map, route); }, [route]);
  useEffect(() => { for (const button of host.current?.querySelectorAll<HTMLButtonElement>(".whale-map-pin") ?? []) button.dataset.selected = String(button.dataset.label === selected.value); }, [selected.value, key]);
  const active = markers.find(marker => marker.label === selected.value);
  return <div className="whale-map"><div className="whale-map-canvas" ref={host} style={{ height: Math.max(160, p.height ?? 320) }} role="region" aria-label={t("streetMap")} />{!markers.length && <Feedback>{t("noLocations")}</Feedback>}{error && <Feedback error>{error} <button type="button" className="whale-button" data-variant="ghost" data-size="sm" onClick={() => setRetry(retry + 1)}>{t("retryMap")}</button></Feedback>}{routeError && <Feedback error>{routeError}</Feedback>}{p.route && markers.length >= 2 && !route && !routeError && <Feedback>{t("loadingRoute")}</Feedback>}<div className="whale-map-locations" role="list">{markers.map((marker, i) => <button key={`${marker.label}-${i}`} type="button" className="whale-map-location" data-selected={selected.value === marker.label || undefined} aria-pressed={selected.value === marker.label} onClick={() => { clickMarker(marker); mapRef.current?.flyTo({ center: [marker.lng, marker.lat], zoom: Math.max(mapRef.current.getZoom(), 12) }); }}><span className="whale-map-label-pin">{marker.icon ?? i + 1}</span><span>{marker.label}{marker.category && <span className="whale-caption">{marker.category}</span>}</span></button>)}</div>{active && <div className="whale-map-selected"><Glyph name="map-pin" size={16} /><span>{active.label}</span></div>}</div>;
}
function updateRoute(map: any, points: number[][] | null) {
  const id = "whale-street-route";
  if (!points) { if (map.getLayer(id)) map.removeLayer(id); if (map.getSource(id)) map.removeSource(id); return; }
  const data = { type: "Feature", properties: {}, geometry: { type: "LineString", coordinates: points } };
  if (map.getSource(id)) map.getSource(id).setData(data);
  else { map.addSource(id, { type: "geojson", data }); const accent = getComputedStyle(document.documentElement).getPropertyValue("--whale-accent").trim() || getComputedStyle(document.documentElement).color; map.addLayer({ id, type: "line", source: id, paint: { "line-color": accent, "line-width": 4, "line-opacity": .85 }, layout: { "line-join": "round", "line-cap": "round" } }); }
}
export const MapComponent = define("Map", { markers: z.array(MapMarker.ref), route: z.boolean().optional(), selected: reactive(z.string()).optional(), height: z.number().optional() }, "MapLibre street map fitted to markers. Optional street route follows marker order; clicking a marker updates the selected binding.", p => <MapView {...p} />);
export const mapDefinitions = [MapComponent, MapMarker];
