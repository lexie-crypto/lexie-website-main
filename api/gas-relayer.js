import { config as sharedConfig, handleGasRelayer } from './proxy.js';

export const config = sharedConfig;

export default async function handler(req, res) {
  return handleGasRelayer(req, res);
}