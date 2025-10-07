/**
 * Timezone utility functions for Node.js backend
 */

/**
 * Convert user local date/time to UTC ISO string
 * @param {string} dateStr - Date in YYYY-MM-DD format
 * @param {string} timeStr - Time in HH:MM format (optional)
 * @param {string} userTimezone - User's timezone (e.g., 'Asia/Ho_Chi_Minh')
 * @returns {string} UTC ISO string
 */
export const convertUserDateTimeToUTC = (dateStr, timeStr = '00:00', userTimezone = 'UTC') => {
  if (!dateStr) return null;
  
  try {
    // Create datetime string
    const datetimeStr = `${dateStr}T${timeStr}:00`;
    
    // Create a Date object assuming the input is in the user's timezone
    // This is a bit tricky in JavaScript, so we use a workaround
    const tempDate = new Date(datetimeStr);
    
    // Get the UTC equivalent by using Intl.DateTimeFormat
    const utcTime = new Date(tempDate.toLocaleString("sv-SE", {timeZone: "UTC"}));
    const userTime = new Date(tempDate.toLocaleString("sv-SE", {timeZone: userTimezone}));
    
    // Calculate the offset
    const offset = utcTime.getTime() - userTime.getTime();
    
    // Apply the offset to get the correct UTC time
    const correctUTC = new Date(tempDate.getTime() + offset);
    
    return correctUTC.toISOString();
  } catch (error) {
    console.error('Error converting user datetime to UTC:', error);
    return null;
  }
};

/**
 * Get current UTC time as ISO string
 * @returns {string} Current UTC time as ISO string
 */
export const getCurrentUTC = () => {
  return new Date().toISOString();
};

/**
 * Format UTC datetime for user timezone
 * @param {string} utcISOString - UTC datetime in ISO format
 * @param {string} userTimezone - User's timezone
 * @param {Object} options - Intl.DateTimeFormat options
 * @returns {string} Formatted datetime in user timezone
 */
export const formatUTCForUser = (utcISOString, userTimezone = 'UTC', options = {}) => {
  if (!utcISOString) return '';
  
  try {
    const date = new Date(utcISOString);
    
    const defaultOptions = {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      timeZone: userTimezone,
      hour12: false
    };
    
    const formatOptions = { ...defaultOptions, ...options };
    
    return new Intl.DateTimeFormat('en-CA', formatOptions).format(date);
  } catch (error) {
    console.error('Error formatting UTC datetime for user:', error);
    return utcISOString;
  }
};