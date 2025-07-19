/**
 * RAILGUN Logger Utilities
 */

export const sendMessage = (message) => {
  console.log(`[RAILGUN] ${message}`);
};

export const sendErrorMessage = (message) => {
  console.error(`[RAILGUN ERROR] ${message}`);
}; 