/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import {
  LayoutDashboard,
  Eye,
  Navigation,
  Mic,
  AlertTriangle,
  Settings,
  ShieldAlert,
} from 'lucide-react';
import { useAppStore, ActiveTab } from '../store/appStore';

interface NavItem {
  id: ActiveTab;
  label: string;
  icon: React.ReactNode;
}

const NAV_ITEMS: NavItem[] = [
  { id: 'dashboard', label: 'Dashboard', icon: <LayoutDashboard className="w-5 h-5" /> },
  { id: 'detection', label: 'Detection', icon: <Eye className="w-5 h-5" /> },
  { id: 'navigation', label: 'Navigation', icon: <Navigation className="w-5 h-5" /> },
  { id: 'voice', label: 'Voice', icon: <Mic className="w-5 h-5" /> },
  { id: 'emergency', label: 'Emergency', icon: <AlertTriangle className="w-5 h-5 text-red-500" /> },
  { id: 'settings', label: 'Settings', icon: <Settings className="w-5 h-5" /> },
];

export const Sidebar: React.FC = () => {
  const activeTab = useAppStore((s) => s.activeTab);
  const setActiveTab = useAppStore((s) => s.setActiveTab);
  const highContrast = useAppStore((s) => s.highContrast);

  return (
    <>
      {/* Desktop Sidebar */}
      <aside
        className={`hidden lg:flex flex-col w-64 shrink-0 p-6 rounded-[28px] my-2 ml-2 transition-colors ${
          highContrast
            ? 'bg-black border-2 border-yellow-400 text-yellow-400'
            : 'bg-white/80 backdrop-blur-md border border-white/60 shadow-[0_8px_30px_rgb(0,0,0,0.04)] text-gray-800'
        }`}
        aria-label="Main Navigation"
      >
        {/* Brand Logo */}
        <div className="flex items-center gap-3 px-2 mb-8">
          <div className="w-10 h-10 rounded-2xl bg-[#14141C] flex items-center justify-center text-white shadow-md">
            <Eye className="w-6 h-6 text-sky-400" />
          </div>
          <div>
            <span className="text-xl font-extrabold tracking-tight block">VISION_AI</span>
            <span className="text-[10px] uppercase font-bold tracking-widest text-sky-600 block">
              Assistive OS
            </span>
          </div>
        </div>

        {/* User Card */}
        <div
          className={`flex items-center gap-3 p-3 rounded-2xl mb-6 transition-colors ${
            highContrast ? 'bg-zinc-900 border border-yellow-400/50' : 'bg-gray-50/80 border border-gray-100'
          }`}
        >
          <div className="w-10 h-10 rounded-full bg-gradient-to-tr from-indigo-500 to-sky-400 flex items-center justify-center text-white font-bold text-sm shadow-sm">
            AM
          </div>
          <div className="overflow-hidden">
            <h4 className="text-xs font-bold truncate">Alex Morgan</h4>
            <p className="text-[10px] opacity-70 truncate">Hands-free User</p>
          </div>
        </div>

        {/* Navigation Items */}
        <nav className="flex-1 space-y-1.5" role="navigation">
          {NAV_ITEMS.map((item) => {
            const isActive = activeTab === item.id;
            return (
              <button
                key={item.id}
                onClick={() => setActiveTab(item.id)}
                aria-current={isActive ? 'page' : undefined}
                className={`w-full flex items-center gap-3.5 px-4 py-3.5 rounded-2xl font-semibold text-sm transition-all text-left relative focus:outline-none focus:ring-2 focus:ring-indigo-500 min-h-[50px] ${
                  isActive
                    ? highContrast
                      ? 'bg-yellow-400 text-black font-extrabold'
                      : 'bg-[#14141C] text-white shadow-md'
                    : highContrast
                    ? 'hover:bg-zinc-900 text-yellow-400'
                    : 'text-gray-600 hover:bg-gray-100/80 hover:text-gray-900'
                }`}
              >
                {/* Thin accent bar */}
                {isActive && (
                  <span
                    className={`absolute left-0 top-2 bottom-2 w-1.5 rounded-r-full ${
                      highContrast ? 'bg-black' : 'bg-sky-400'
                    }`}
                  />
                )}
                {item.icon}
                <span>{item.label}</span>
              </button>
            );
          })}
        </nav>

        {/* Small dark card at the bottom */}
        <div
          className={`mt-auto p-4 rounded-2xl text-xs relative overflow-hidden transition-colors ${
            highContrast
              ? 'bg-zinc-900 border border-yellow-400/60 text-yellow-400'
              : 'bg-[#14141C] text-white shadow-md'
          }`}
        >
          <div className="flex items-center gap-2 font-bold mb-1 text-sky-400">
            <ShieldAlert className="w-4 h-4 shrink-0" />
            <span>Activity History</span>
          </div>
          <p className="text-[11px] opacity-80 leading-relaxed">
            History available. Check your weekly activity reports.
          </p>
        </div>
      </aside>

      {/* Mobile Bottom Navigation Bar */}
      <nav
        className={`lg:hidden fixed bottom-0 left-0 right-0 z-40 px-3 py-2 border-t backdrop-blur-lg flex items-center justify-around transition-colors ${
          highContrast
            ? 'bg-black border-yellow-400 text-yellow-400'
            : 'bg-white/95 border-gray-200/80 text-gray-700 shadow-lg'
        }`}
        aria-label="Mobile Navigation"
      >
        {NAV_ITEMS.map((item) => {
          const isActive = activeTab === item.id;
          return (
            <button
              key={item.id}
              onClick={() => setActiveTab(item.id)}
              aria-label={item.label}
              className={`flex flex-col items-center justify-center p-2 rounded-xl transition-all min-w-[54px] min-h-[54px] ${
                isActive
                  ? highContrast
                    ? 'bg-yellow-400 text-black font-bold'
                    : 'bg-[#14141C] text-white'
                  : 'text-gray-500 hover:text-gray-900'
              }`}
            >
              {item.icon}
              <span className="text-[10px] font-semibold mt-0.5">{item.label}</span>
            </button>
          );
        })}
      </nav>
    </>
  );
};
