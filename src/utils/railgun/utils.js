/**
 * RAILGUN Utilities - Error Handling
 */

export const reportAndSanitizeError = (functionName, error) => {
  console.error(`[${functionName}] Error:`, error);
  
  // Sanitize the error for user display
  if (error instanceof Error) {
    return new Error(`${functionName}: ${error.message}`);
  }
  
  if (typeof error === 'string') {
    return new Error(`${functionName}: ${error}`);
  }
  
  return new Error(`${functionName}: An unknown error occurred`);
}; 