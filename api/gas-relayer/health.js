import { healthHandler } from '../../../lexie-gas-relayer/src/backend/relayer-proxy-handlers.js';

export const config = {
  api: { bodyParser: false }
};

export default healthHandler;

