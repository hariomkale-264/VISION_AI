/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { RouteStep } from '../store/appStore';

export interface RouteResult {
  coordinates: Array<[number, number]>; // Leaflet [lat, lng] pairs
  distanceMeters: number;
  durationSeconds: number;
  steps: RouteStep[];
}

/**
 * Calculates a pedestrian walking route using OSRM's foot profile.
 */
export async function getWalkingRoute(
  startLat: number,
  startLng: number,
  endLat: number,
  endLng: number
): Promise<RouteResult> {
  const url = `https://router.project-osrm.org/route/v1/foot/${startLng},${startLat};${endLng},${endLat}?overview=full&geometries=geojson&steps=true`;

  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`OSRM routing failed with status ${response.status}`);
  }

  const data = await response.json();
  if (!data.routes || data.routes.length === 0) {
    throw new Error('No pedestrian route found between these locations.');
  }

  const route = data.routes[0];
  // GeoJSON coordinates are [lon, lat] -> convert to Leaflet [lat, lon]
  const coordinates: Array<[number, number]> = route.geometry.coordinates.map(
    (coord: [number, number]) => [coord[1], coord[0]]
  );

  const steps: RouteStep[] = [];
  if (route.legs && route.legs[0] && route.legs[0].steps) {
    for (const s of route.legs[0].steps) {
      const maneuver = s.maneuver || {};
      const stepLocation: [number, number] = maneuver.location
        ? [maneuver.location[1], maneuver.location[0]]
        : [coordinates[0][0], coordinates[0][1]];

      const instruction = formatManeuverInstruction(s.name, maneuver.type, maneuver.modifier);

      steps.push({
        instruction,
        distance: Math.round(s.distance || 0),
        location: stepLocation,
        maneuverType: maneuver.type,
        modifier: maneuver.modifier,
      });
    }
  }

  return {
    coordinates,
    distanceMeters: Math.round(route.distance || 0),
    durationSeconds: Math.round(route.duration || 0),
    steps,
  };
}

function formatManeuverInstruction(streetName: string, type?: string, modifier?: string): string {
  const street = streetName && streetName.trim().length > 0 ? `onto ${streetName}` : 'ahead';

  if (type === 'depart') {
    return `Head ${modifier ? modifier : 'forward'} ${street}`;
  }
  if (type === 'arrive') {
    return 'You have arrived at your destination';
  }
  if (type === 'turn') {
    return `Turn ${modifier || 'forward'} ${street}`;
  }
  if (type === 'new name') {
    return `Continue ${street}`;
  }
  if (type === 'end of road') {
    return `At the end of the road, turn ${modifier || 'forward'}`;
  }
  if (modifier) {
    return `Bear ${modifier} ${street}`;
  }
  return `Continue straight ${street}`;
}
