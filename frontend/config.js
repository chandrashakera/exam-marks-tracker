// Public runtime config for the frontend.
// No secrets here — the Web App URL is inherently public (the backend is
// deployed with "Anyone" access, per the brief's no-login requirement), and
// the Gemini API key lives server-side only, in Apps Script Script
// Properties (see backend/Code.gs).
const CONFIG = {
  WEBAPP_URL: 'https://script.google.com/macros/s/AKfycbz_5UGK_q-orp68I5p-Ibf_9BPe3SY8-5umBxZQcm1k858_Supi2Yu15hZ7jm8KND38dg/exec'
};
