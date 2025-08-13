import { submitHandler } from '../../../lexie-gas-relayer/src/backend/relayer-proxy-handlers.js';

export const config = {
  api: { bodyParser: true }
};

export default submitHandler;

