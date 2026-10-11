/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useRef } from 'react';
import {
  ShieldCheck,
  CheckCircle2,
  XCircle,
  Clock,
  RotateCw,
  Copy,
  ExternalLink,
  X,
  Sparkles,
  Volume2,
  AlertTriangle,
  Check,
  Terminal,
} from 'lucide-react';
import { useAppStore } from '../store/appStore';
import {
  SelfTestItem,
  INITIAL_SELF_TEST_ITEMS,
  runSelfTestSequence,
  formatSelfTestReport,
} from '../services/selfTestRunner';

export const SelfTestModal: React.FC = () => {
  const selfTestOpen = useAppStore((s) => s.selfTestOpen);
  const setSelfTestOpen = useAppStore((s) => s.setSelfTestOpen);
  const highContrast = useAppStore((s) => s.highContrast);

  const [items, setItems] = useState<SelfTestItem[]>(() =>
    INITIAL_SELF_TEST_ITEMS.map((item) => ({ ...item }))
  );
  const [isRunning, setIsRunning] = useState(false);
  const [currentIndex, setCurrentIndex] = useState<number | null>(null);
  const [summaryText, setSummaryText] = useState<string>('');
  const [copied, setCopied] = useState(false);

  const isCancelledRef = useRef(false);

  // Auto-start when modal opens
  useEffect(() => {
    if (selfTestOpen) {
      handleStartSelfTest();
    } else {
      isCancelledRef.current = true;
    }
  }, [selfTestOpen]);

  const handleStartSelfTest = async () => {
    if (isRunning) return;
    isCancelledRef.current = false;
    setIsRunning(true);
    setSummaryText('');
    setCopied(false);
    setItems(INITIAL_SELF_TEST_ITEMS.map((item) => ({ ...item })));

    try {
      const result = await runSelfTestSequence(
        (updatedItems, curIdx) => {
          setItems([...updatedItems]);
          setCurrentIndex(curIdx);
        },
        () => isCancelledRef.current
      );

      if (!isCancelledRef.current) {
        setSummaryText(result.summary);
      }
    } catch (err: any) {
      console.error('Self test run failed:', err);
    } finally {
      setIsRunning(false);
      setCurrentIndex(null);
    }
  };

  const handleCancel = () => {
    isCancelledRef.current = true;
    setIsRunning(false);
    setCurrentIndex(null);
  };

  const handleClose = () => {
    handleCancel();
    setSelfTestOpen(false);
  };

  const handleCopyReport = async () => {
    const report = formatSelfTestReport(items);
    try {
      await navigator.clipboard.writeText(report);
      setCopied(true);
      setTimeout(() => setCopied(false), 3000);
    } catch (err) {
      console.warn('Clipboard write error:', err);
    }
  };

  if (!selfTestOpen) return null;

  const passedCount = items.filter((i) => i.status === 'pass').length;
  const failedCount = items.filter((i) => i.status === 'fail').length;
  const totalCount = items.length;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="selftest-title"
      className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-6 bg-black/80 backdrop-blur-md animate-fade-in"
    >
      <div
        className={`w-full max-w-4xl max-h-[92vh] flex flex-col rounded-[28px] sm:rounded-[36px] overflow-hidden shadow-2xl transition-all border ${
          highContrast
            ? 'bg-black text-yellow-400 border-4 border-yellow-400'
            : 'bg-[#0f172a] text-white border-white/10 shadow-indigo-950/80'
        }`}
      >
        {/* Modal Header */}
        <div
          className={`p-5 sm:p-6 border-b flex items-center justify-between gap-4 ${
            highContrast
              ? 'border-yellow-400/50 bg-zinc-950'
              : 'border-white/10 bg-slate-900/60'
          }`}
        >
          <div className="flex items-center gap-3.5">
            <div
              className={`w-12 h-12 rounded-2xl flex items-center justify-center shrink-0 shadow-lg ${
                highContrast
                  ? 'bg-yellow-400 text-black'
                  : 'bg-indigo-600 text-white shadow-indigo-600/40'
              }`}
            >
              <ShieldCheck className="w-7 h-7" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 id="selftest-title" className="text-xl sm:text-2xl font-black tracking-tight">
                  System Self-Test
                </h2>
                <span
                  className={`px-2.5 py-0.5 rounded-full text-xs font-bold uppercase tracking-wider ${
                    isRunning
                      ? 'bg-amber-400/20 text-amber-300 border border-amber-400/40 animate-pulse'
                      : failedCount === 0 && passedCount === totalCount
                      ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40'
                      : 'bg-slate-700/60 text-slate-300'
                  }`}
                >
                  {isRunning ? 'Running' : 'Ready'}
                </span>
              </div>
              <p className="text-xs sm:text-sm font-semibold opacity-75">
                Automated 11-point diagnostic check for microphone, speech, vision, GPS, and AI.
              </p>
            </div>
          </div>

          <button
            onClick={handleClose}
            aria-label="Close self-test dialog"
            className={`p-2.5 rounded-2xl transition-all cursor-pointer ${
              highContrast
                ? 'hover:bg-yellow-400 hover:text-black border border-yellow-400'
                : 'hover:bg-white/10 text-slate-300 hover:text-white'
            }`}
          >
            <X className="w-6 h-6" />
          </button>
        </div>

        {/* Progress & Summary Bar */}
        <div
          className={`px-5 sm:px-6 py-3.5 border-b flex flex-wrap items-center justify-between gap-3 text-xs sm:text-sm font-bold ${
            highContrast
              ? 'bg-black border-yellow-400/30'
              : 'bg-slate-950/40 border-white/5'
          }`}
        >
          <div className="flex items-center gap-3">
            <span>
              Passed: <strong className="text-emerald-400 font-black">{passedCount}</strong> / {totalCount}
            </span>
            {failedCount > 0 && (
              <span className="text-rose-400 font-bold">
                Failed: <strong>{failedCount}</strong>
              </span>
            )}
            {isRunning && currentIndex !== null && (
              <span className="flex items-center gap-1.5 text-amber-400 animate-pulse font-semibold">
                <RotateCw className="w-3.5 h-3.5 animate-spin" />
                <span>Checking step {currentIndex + 1} of {totalCount}...</span>
              </span>
            )}
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={handleCopyReport}
              aria-label="Copy self-test report"
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold transition-all cursor-pointer ${
                copied
                  ? 'bg-emerald-600 text-white'
                  : highContrast
                  ? 'bg-yellow-400 text-black hover:bg-yellow-300'
                  : 'bg-white/10 hover:bg-white/20 text-white border border-white/10'
              }`}
            >
              {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
              <span>{copied ? 'Copied!' : 'Copy Report'}</span>
            </button>

            {isRunning ? (
              <button
                onClick={handleCancel}
                aria-label="Cancel self-test"
                className="px-3 py-1.5 rounded-xl text-xs font-bold bg-rose-600 hover:bg-rose-500 text-white cursor-pointer"
              >
                Stop
              </button>
            ) : (
              <button
                onClick={handleStartSelfTest}
                aria-label="Rerun self-test"
                className={`flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl text-xs font-black cursor-pointer shadow-md ${
                  highContrast
                    ? 'bg-yellow-400 text-black hover:bg-yellow-300'
                    : 'bg-indigo-600 hover:bg-indigo-500 text-white'
                }`}
              >
                <RotateCw className="w-3.5 h-3.5" />
                <span>Rerun All</span>
              </button>
            )}
          </div>
        </div>

        {/* Spoken Summary Banner when complete */}
        {summaryText && (
          <div
            className={`mx-5 sm:mx-6 mt-4 p-3.5 rounded-2xl flex items-center gap-3 text-xs sm:text-sm font-bold ${
              failedCount === 0
                ? 'bg-emerald-950/60 border border-emerald-500/40 text-emerald-200'
                : 'bg-amber-950/60 border border-amber-500/40 text-amber-200'
            }`}
          >
            <Volume2 className="w-5 h-5 shrink-0 text-amber-400" />
            <span className="flex-1 font-semibold">{summaryText}</span>
          </div>
        )}

        {/* Scrollable Check List */}
        <div className="flex-1 overflow-y-auto p-5 sm:p-6 space-y-3.5">
          {items.map((item, idx) => {
            const isItemRunning = item.status === 'running';
            const isPass = item.status === 'pass';
            const isFail = item.status === 'fail';

            return (
              <div
                key={item.id}
                className={`p-4 sm:p-5 rounded-2xl border transition-all ${
                  isItemRunning
                    ? 'bg-indigo-950/40 border-indigo-400/60 ring-2 ring-indigo-500/30'
                    : isPass
                    ? highContrast
                      ? 'bg-zinc-950 border-yellow-400/80 text-yellow-300'
                      : 'bg-slate-900/40 border-emerald-500/30'
                    : isFail
                    ? highContrast
                      ? 'bg-zinc-950 border-red-500 text-red-300'
                      : 'bg-red-950/20 border-red-500/40'
                    : 'bg-slate-900/20 border-white/5 opacity-60'
                }`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-start gap-3">
                    <div className="mt-0.5 shrink-0">
                      {isItemRunning ? (
                        <RotateCw className="w-5 h-5 text-indigo-400 animate-spin" />
                      ) : isPass ? (
                        <CheckCircle2 className="w-5 h-5 text-emerald-400" />
                      ) : isFail ? (
                        <XCircle className="w-5 h-5 text-rose-400" />
                      ) : (
                        <Clock className="w-5 h-5 text-slate-500" />
                      )}
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <h3 className="font-extrabold text-sm sm:text-base tracking-tight">
                          {item.title}
                        </h3>
                        {item.durationMs !== undefined && (
                          <span className="text-[11px] font-mono opacity-50">
                            {item.durationMs}ms
                          </span>
                        )}
                      </div>
                      <p className="text-xs opacity-75 font-medium leading-relaxed mt-0.5">
                        {item.description}
                      </p>
                    </div>
                  </div>

                  {/* Status Badge */}
                  <span
                    className={`px-3 py-1 rounded-xl text-xs font-black shrink-0 uppercase tracking-wider ${
                      isPass
                        ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
                        : isFail
                        ? 'bg-rose-500/20 text-rose-400 border border-rose-500/30'
                        : isItemRunning
                        ? 'bg-indigo-500/20 text-indigo-300 border border-indigo-500/30 animate-pulse'
                        : 'bg-slate-800 text-slate-400'
                    }`}
                  >
                    {item.status}
                  </span>
                </div>

                {/* Success Detail */}
                {item.detail && (
                  <div className="mt-3 pt-2.5 border-t border-white/5 text-xs font-mono text-emerald-300/90 break-words flex items-center justify-between gap-2">
                    <div className="flex items-start gap-2">
                      <Terminal className="w-4 h-4 shrink-0 opacity-70 mt-0.5" />
                      <span>{item.detail}</span>
                    </div>

                    {/* Navigation Dry Run "Test redirect now" Button */}
                    {item.navUrl && (
                      <button
                        onClick={() => window.open(item.navUrl, '_blank')}
                        className={`shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-xl font-bold text-xs shadow-md transition-all cursor-pointer ${
                          highContrast
                            ? 'bg-yellow-400 text-black hover:bg-yellow-300'
                            : 'bg-emerald-600 hover:bg-emerald-500 text-white'
                        }`}
                        aria-label="Test redirect to Google Maps now"
                      >
                        <ExternalLink className="w-3.5 h-3.5" />
                        <span>Test redirect now</span>
                      </button>
                    )}
                  </div>
                )}

                {/* Error Detail */}
                {item.error && (
                  <div className="mt-3 pt-2.5 border-t border-rose-500/20 text-xs font-semibold text-rose-400 flex items-start gap-2">
                    <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                    <span>Reason: {item.error}</span>
                  </div>
                )}

                {/* Command Parsing Detail Matrix for Check 5 */}
                {item.commandParsingRows && (
                  <div className="mt-3.5 pt-3 border-t border-white/10 space-y-2">
                    <h4 className="text-[11px] font-bold uppercase tracking-wider text-slate-400">
                      Actual vs Expected Command Parsing:
                    </h4>
                    <div className="overflow-x-auto rounded-xl border border-white/10">
                      <table className="w-full text-left text-xs font-mono">
                        <thead className="bg-white/5 text-slate-300 text-[11px]">
                          <tr>
                            <th className="p-2">Spoken Test Sentence</th>
                            <th className="p-2">Expected</th>
                            <th className="p-2">Actual</th>
                            <th className="p-2 text-center">Status</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-white/5">
                          {item.commandParsingRows.map((row, rIdx) => (
                            <tr key={rIdx} className="hover:bg-white/5">
                              <td className="p-2 font-medium text-slate-200">
                                &ldquo;{row.sentence}&rdquo;
                              </td>
                              <td className="p-2 text-sky-300">{row.expected}</td>
                              <td className="p-2 text-amber-300">{row.actual}</td>
                              <td className="p-2 text-center">
                                {row.passed ? (
                                  <span className="text-emerald-400 font-bold">PASS</span>
                                ) : (
                                  <span className="text-rose-400 font-bold">FAIL</span>
                                )}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* Modal Footer */}
        <div
          className={`p-4 sm:p-5 border-t flex flex-wrap items-center justify-between gap-3 ${
            highContrast
              ? 'border-yellow-400/40 bg-zinc-950'
              : 'border-white/10 bg-slate-900/80'
          }`}
        >
          <div className="text-xs opacity-75">
            Voice command trigger: say <strong className="font-bold">&ldquo;run self test&rdquo;</strong> or <strong className="font-bold">&ldquo;check everything&rdquo;</strong>.
          </div>

          <div className="flex items-center gap-3">
            <button
              onClick={handleCopyReport}
              className={`flex items-center gap-1.5 px-4 py-2.5 rounded-xl font-bold text-xs transition-all cursor-pointer ${
                copied
                  ? 'bg-emerald-600 text-white'
                  : highContrast
                  ? 'bg-zinc-800 text-yellow-400 border border-yellow-400'
                  : 'bg-white/10 hover:bg-white/20 text-white border border-white/10'
              }`}
            >
              {copied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
              <span>{copied ? 'Report Copied' : 'Copy Report'}</span>
            </button>

            <button
              onClick={handleClose}
              className={`px-5 py-2.5 rounded-xl font-black text-xs transition-all cursor-pointer ${
                highContrast
                  ? 'bg-yellow-400 text-black hover:bg-yellow-300'
                  : 'bg-slate-800 hover:bg-slate-700 text-white'
              }`}
            >
              Close
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
