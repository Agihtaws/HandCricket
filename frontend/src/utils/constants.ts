
function getRequired(name: string): string {
  const val = import.meta.env[name];
  if (!val) throw new Error(`Missing required environment variable: ${name}`);
  return val;
}

export const PACKAGE_ID   = getRequired('VITE_PACKAGE_ID');
export const TREASURY_ID  = getRequired('VITE_TREASURY_ID');
export const WS_URL       = getRequired('VITE_WS_URL');
export const BACKEND_URL  = getRequired('VITE_BACKEND_URL');
export const API_KEY      = getRequired('VITE_API_KEY');

export const BET_AMOUNT   = 100_000_000n; // 0.1 OCT in MIST