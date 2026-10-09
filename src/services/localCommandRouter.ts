/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  routeVoiceCommand,
  registerVoiceRouterProviders,
  VoiceRouteResult,
} from './voiceRouter';

export type LocalRouteResult = VoiceRouteResult;

export function registerLocalCommandProviders(
  snapshotGetter: () => string | null,
  stopMic: () => void,
  startMic: () => void
) {
  registerVoiceRouterProviders(snapshotGetter, stopMic, startMic);
}

export async function tryLocalCommand(rawText: string): Promise<LocalRouteResult> {
  return await routeVoiceCommand(rawText);
}
