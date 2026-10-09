/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useRef } from 'react';
import L from 'leaflet';
import {
  Navigation,
  Compass,
  MapPin,
  Clock,
  Gauge,
  XCircle,
  CornerUpRight,
} from 'lucide-react';
import { useAppStore } from '../store/appStore';
import { formatDistance } from '../utils/haversine';

export const NavigationCard: React.FC = () => {
  const mapContainerRef = useRef<HTMLDivElement | null>(null);
  const mapInstanceRef = useRef<L.Map | null>(null);
  const userMarkerRef = useRef<L.CircleMarker | null>(null);
  const routePolylineRef = useRef<L.Polyline | null>(null);
  const destMarkerRef = useRef<L.Marker | null>(null);

  const navigationActive = useAppStore((s) => s.navigationActive);
  const destination = useAppStore((s) => s.destination);
  const destinationCoords = useAppStore((s) => s.destinationCoords);
  const routePolyline = useAppStore((s) => s.routePolyline);
  const routeSteps = useAppStore((s) => s.routeSteps);
  const currentStepIndex = useAppStore((s) => s.currentStepIndex);
  const distanceRemainingMeters = useAppStore((s) => s.distanceRemainingMeters);
  const durationRemainingSec = useAppStore((s) => s.durationRemainingSec);
  const currentLocation = useAppStore((s) => s.currentLocation);
  const isRerouting = useAppStore((s) => s.isRerouting);
  const stopNavigation = useAppStore((s) => s.stopNavigation);
  const highContrast = useAppStore((s) => s.highContrast);

  // Initialize Leaflet Map
  useEffect(() => {
    if (!mapContainerRef.current) return;

    if (!mapInstanceRef.current) {
      const defaultLat = currentLocation.lat || 40.7128;
      const defaultLng = currentLocation.lng || -74.006;

      const map = L.map(mapContainerRef.current, {
        zoomControl: true,
        attributionControl: false,
      }).setView([defaultLat, defaultLng], 16);

      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 19,
      }).addTo(map);

      mapInstanceRef.current = map;
    }

    return () => {
      if (mapInstanceRef.current) {
        mapInstanceRef.current.remove();
        mapInstanceRef.current = null;
      }
    };
  }, []);

  // Update User Location Dot
  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map || currentLocation.lat == null || currentLocation.lng == null) return;

    const userLatLng: L.LatLngTuple = [currentLocation.lat, currentLocation.lng];

    if (!userMarkerRef.current) {
      // Pulsing blue dot
      userMarkerRef.current = L.circleMarker(userLatLng, {
        radius: 8,
        color: '#FFFFFF',
        weight: 2,
        fillColor: '#3B82F6',
        fillOpacity: 0.9,
      }).addTo(map);
    } else {
      userMarkerRef.current.setLatLng(userLatLng);
    }

    // If navigation is active, keep view tracking or fitting route
    if (!navigationActive) {
      map.setView(userLatLng, map.getZoom());
    }
  }, [currentLocation.lat, currentLocation.lng, navigationActive]);

  // Update Route Polyline & Destination Marker
  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map) return;

    if (routePolyline.length > 0 && navigationActive) {
      const latLngs: L.LatLngExpression[] = routePolyline.map((c) => [c[0], c[1]]);

      if (routePolylineRef.current) {
        routePolylineRef.current.setLatLngs(latLngs);
      } else {
        routePolylineRef.current = L.polyline(latLngs, {
          color: '#2563EB',
          weight: 6,
          opacity: 0.85,
          lineCap: 'round',
          lineJoin: 'round',
        }).addTo(map);
      }

      if (destinationCoords) {
        if (destMarkerRef.current) {
          destMarkerRef.current.setLatLng(destinationCoords);
        } else {
          destMarkerRef.current = L.marker(destinationCoords).addTo(map);
        }
      }

      // Fit map bounds to show route
      map.fitBounds(L.latLngBounds(latLngs), { padding: [30, 30] });
    } else {
      // Clean up when navigation stops
      if (routePolylineRef.current) {
        map.removeLayer(routePolylineRef.current);
        routePolylineRef.current = null;
      }
      if (destMarkerRef.current) {
        map.removeLayer(destMarkerRef.current);
        destMarkerRef.current = null;
      }
    }
  }, [routePolyline, destinationCoords, navigationActive]);

  const currentStep = routeSteps[currentStepIndex];

  return (
    <div
      className={`rounded-[24px] p-5 shadow-[0_10px_25px_-5px_rgba(0,0,0,0.05),0_8px_10px_-6px_rgba(0,0,0,0.01)] transition-all ${
        highContrast
          ? 'bg-black border-2 border-yellow-400 text-yellow-400'
          : 'bg-white border border-gray-100 text-gray-900'
      }`}
    >
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2.5">
          <div
            className={`w-10 h-10 rounded-2xl flex items-center justify-center ${
              highContrast ? 'bg-yellow-400 text-black' : 'bg-[#14141C] text-white shadow-sm'
            }`}
          >
            <Navigation className="w-5 h-5 text-amber-400" />
          </div>
          <div>
            <h3 className="font-extrabold text-base tracking-tight">Turn-by-Turn Navigation</h3>
            <p className="text-xs font-semibold opacity-70">
              {navigationActive
                ? `Route active to ${destination}`
                : 'Pedestrian guidance standby'}
            </p>
          </div>
        </div>

        {navigationActive && (
          <button
            onClick={stopNavigation}
            aria-label="Stop navigation"
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-red-100 text-red-700 font-bold text-xs hover:bg-red-200 transition min-h-[44px]"
          >
            <XCircle className="w-3.5 h-3.5" />
            <span>Stop Route</span>
          </button>
        )}
      </div>

      {/* Active Turn Instruction Banner */}
      {navigationActive && currentStep && (
        <div
          className={`p-4 rounded-2xl mb-4 border flex items-center gap-3 transition-colors ${
            highContrast
              ? 'bg-zinc-900 border-yellow-400 text-yellow-300'
              : 'bg-indigo-600 text-white shadow-md'
          }`}
        >
          <div className="w-10 h-10 rounded-xl bg-white/20 flex items-center justify-center shrink-0">
            <CornerUpRight className="w-6 h-6" />
          </div>
          <div>
            <div className="text-[11px] font-bold uppercase tracking-wider opacity-90">
              Next Step · In {formatDistance(currentStep.distance)}
            </div>
            <div className="text-sm sm:text-base font-extrabold tracking-tight">
              {currentStep.instruction}
            </div>
          </div>
        </div>
      )}

      {isRerouting && (
        <div className="p-3 rounded-xl bg-amber-100 text-amber-900 font-bold text-xs mb-3 animate-pulse">
          Rerouting... Computing updated walking path.
        </div>
      )}

      {/* Map Container */}
      <div className="relative w-full h-64 sm:h-72 rounded-2xl overflow-hidden bg-gray-100 border border-gray-200">
        <div ref={mapContainerRef} className="w-full h-full z-10" />

        {/* Floating Trip Info Badge on Map */}
        <div className="absolute top-3 left-3 z-20 bg-white/90 backdrop-blur-md px-3 py-1.5 rounded-xl shadow-md text-xs font-bold text-gray-800 flex items-center gap-2">
          <MapPin className="w-3.5 h-3.5 text-indigo-600" />
          <span className="truncate max-w-[200px]">{currentLocation.address}</span>
        </div>
      </div>

      {/* Trip Metrics Row */}
      <div className="mt-4 grid grid-cols-2 sm:grid-cols-4 gap-3 pt-3 border-t border-gray-100">
        <div className="p-2.5 rounded-xl bg-gray-50 text-xs">
          <div className="opacity-70 flex items-center gap-1 mb-0.5">
            <Compass className="w-3.5 h-3.5" />
            <span>Remaining</span>
          </div>
          <div className="font-extrabold text-sm">
            {navigationActive ? formatDistance(distanceRemainingMeters) : '0 m'}
          </div>
        </div>

        <div className="p-2.5 rounded-xl bg-gray-50 text-xs">
          <div className="opacity-70 flex items-center gap-1 mb-0.5">
            <Clock className="w-3.5 h-3.5" />
            <span>ETA</span>
          </div>
          <div className="font-extrabold text-sm">
            {navigationActive ? `${Math.ceil(durationRemainingSec / 60)} min` : '--'}
          </div>
        </div>

        <div className="p-2.5 rounded-xl bg-gray-50 text-xs">
          <div className="opacity-70 flex items-center gap-1 mb-0.5">
            <Gauge className="w-3.5 h-3.5" />
            <span>Walking Speed</span>
          </div>
          <div className="font-extrabold text-sm">
            {currentLocation.speed ? `${(currentLocation.speed * 3.6).toFixed(1)} km/h` : '0 km/h'}
          </div>
        </div>

        <div className="p-2.5 rounded-xl bg-gray-50 text-xs">
          <div className="opacity-70 flex items-center gap-1 mb-0.5">
            <MapPin className="w-3.5 h-3.5" />
            <span>GPS Accuracy</span>
          </div>
          <div className="font-extrabold text-sm">
            {currentLocation.accuracy ? `±${Math.round(currentLocation.accuracy)}m` : 'Finding...'}
          </div>
        </div>
      </div>
    </div>
  );
};
