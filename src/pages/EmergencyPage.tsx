/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from 'react';
import { AlertTriangle, MapPin, Phone, User, Check, Share2 } from 'lucide-react';
import { useAppStore } from '../store/appStore';
import { handleEmergencySos } from '../services/intentRouter';
import { speechQueue, SpeechPriority } from '../services/speechQueue';

export const EmergencyPage: React.FC = () => {
  const currentLocation = useAppStore((s) => s.currentLocation);
  const emergencyContact = useAppStore((s) => s.emergencyContact);
  const setEmergencyContact = useAppStore((s) => s.setEmergencyContact);
  const highContrast = useAppStore((s) => s.highContrast);

  const [contactName, setContactName] = useState(emergencyContact.name);
  const [contactPhone, setContactPhone] = useState(emergencyContact.phone);
  const [savedSuccess, setSavedSuccess] = useState(false);

  const handleSaveContact = (e: React.FormEvent) => {
    e.preventDefault();
    setEmergencyContact({ name: contactName, phone: contactPhone });
    setSavedSuccess(true);
    speechQueue.speak('Emergency contact saved.', SpeechPriority.STATUS);
    setTimeout(() => setSavedSuccess(false), 3000);
  };

  const lat = currentLocation.lat != null ? currentLocation.lat.toFixed(6) : '0';
  const lng = currentLocation.lng != null ? currentLocation.lng.toFixed(6) : '0';
  const mapsUrl = `https://www.google.com/maps?q=${lat},${lng}`;

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-extrabold tracking-tight">Emergency Assistance & SOS</h2>
        <p className="text-xs font-semibold opacity-70">
          Trigger immediate location broadcast via voice or the big button below.
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Huge Red SOS Hero Button Card */}
        <div
          className={`rounded-[32px] p-8 text-center flex flex-col items-center justify-center gap-6 shadow-xl transition-all ${
            highContrast
              ? 'bg-black border-4 border-red-500 text-white'
              : 'bg-red-50/60 border-2 border-red-200 text-red-950'
          }`}
        >
          <div className="w-16 h-16 rounded-full bg-red-600 text-white flex items-center justify-center shadow-lg shadow-red-600/30">
            <AlertTriangle className="w-9 h-9 animate-pulse" />
          </div>

          <div>
            <h3 className="text-2xl font-black tracking-tight">EMERGENCY ASSISTANCE</h3>
            <p className="text-xs font-semibold opacity-80 mt-1 max-w-sm">
              Press the SOS button or say &ldquo;emergency&rdquo; or &ldquo;help me&rdquo; to send your exact GPS location.
            </p>
          </div>

          <button
            onClick={handleEmergencySos}
            aria-label="Send Emergency SOS with current location"
            className="w-full max-w-xs py-5 rounded-2xl bg-red-600 hover:bg-red-700 text-white font-black text-lg tracking-wider shadow-2xl shadow-red-600/40 active:scale-95 transition-all min-h-[64px]"
          >
            TRIGGER SOS NOW
          </button>

          <div className="text-xs opacity-75 flex items-center gap-2">
            <Share2 className="w-4 h-4" />
            <span>Shares GPS coordinates & address to emergency contact</span>
          </div>
        </div>

        {/* Current Location & Saved Contact */}
        <div className="space-y-6">
          {/* Current GPS Coordinates preview */}
          <div
            className={`rounded-[24px] p-5 shadow-[0_10px_25px_-5px_rgba(0,0,0,0.05)] transition-all ${
              highContrast
                ? 'bg-black border-2 border-yellow-400 text-yellow-400'
                : 'bg-white border border-gray-100 text-gray-900'
            }`}
          >
            <div className="flex items-center gap-2 mb-3">
              <MapPin className="w-5 h-5 text-indigo-600" />
              <h4 className="font-extrabold text-base tracking-tight">Your Current GPS Broadcast</h4>
            </div>

            <div className="p-3.5 rounded-xl bg-gray-50 border border-gray-100 text-xs space-y-1">
              <div>
                <strong>Address:</strong> {currentLocation.address}
              </div>
              <div className="font-mono text-[11px] opacity-75">
                Latitude: {lat} · Longitude: {lng}
              </div>
              <div className="text-indigo-600 underline truncate pt-1">
                <a href={mapsUrl} target="_blank" rel="noopener noreferrer">
                  {mapsUrl}
                </a>
              </div>
            </div>
          </div>

          {/* Emergency Contact Configuration */}
          <div
            className={`rounded-[24px] p-5 shadow-[0_10px_25px_-5px_rgba(0,0,0,0.05)] transition-all ${
              highContrast
                ? 'bg-black border-2 border-yellow-400 text-yellow-400'
                : 'bg-white border border-gray-100 text-gray-900'
            }`}
          >
            <h4 className="font-extrabold text-base tracking-tight mb-2">Emergency Contact</h4>
            <p className="text-xs opacity-70 mb-4">
              Saved locally on your device for one-tap SMS/Web sharing during an SOS event.
            </p>

            <form onSubmit={handleSaveContact} className="space-y-3 text-xs">
              <div>
                <label className="block font-bold mb-1 opacity-80">Contact Name</label>
                <div className="flex items-center gap-2 p-2.5 rounded-xl border border-gray-200">
                  <User className="w-4 h-4 opacity-50" />
                  <input
                    type="text"
                    value={contactName}
                    onChange={(e) => setContactName(e.target.value)}
                    placeholder="e.g. Sarah (Family)"
                    aria-label="Emergency contact name"
                    className="w-full bg-transparent focus:outline-none font-medium"
                  />
                </div>
              </div>

              <div>
                <label className="block font-bold mb-1 opacity-80">Phone Number</label>
                <div className="flex items-center gap-2 p-2.5 rounded-xl border border-gray-200">
                  <Phone className="w-4 h-4 opacity-50" />
                  <input
                    type="tel"
                    value={contactPhone}
                    onChange={(e) => setContactPhone(e.target.value)}
                    placeholder="e.g. +1 555 019 2834"
                    aria-label="Emergency contact phone number"
                    className="w-full bg-transparent focus:outline-none font-medium"
                  />
                </div>
              </div>

              <button
                type="submit"
                aria-label="Save emergency contact"
                className="w-full py-3 rounded-xl bg-indigo-600 text-white font-bold hover:bg-indigo-700 transition flex items-center justify-center gap-1.5 min-h-[48px]"
              >
                {savedSuccess ? (
                  <>
                    <Check className="w-4 h-4" />
                    <span>Saved Successfully</span>
                  </>
                ) : (
                  <span>Save Contact Details</span>
                )}
              </button>
            </form>
          </div>
        </div>
      </div>
    </div>
  );
};
