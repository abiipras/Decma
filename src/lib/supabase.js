import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL?.trim() || '';
const publishableKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY?.trim() || '';

const validUrl = (() => {
  try {
    const parsed = new URL(supabaseUrl);
    return parsed.protocol === 'https:' || parsed.hostname === 'localhost';
  } catch {
    return false;
  }
})();

export const isSupabaseConfigured = Boolean(validUrl && publishableKey);

export const supabase = isSupabaseConfigured
  ? createClient(supabaseUrl, publishableKey, {
      auth: {
        autoRefreshToken: true,
        persistSession: true,
        detectSessionInUrl: true,
      },
    })
  : null;

// This lightweight Auth health check uses the publishable key without reading
// or changing any database records. The REST root returns an OpenAPI schema
// and is not available to publishable keys.
export async function verifySupabaseConnection() {
  if (!isSupabaseConfigured) {
    throw new Error('Supabase URL or publishable key is missing or invalid.');
  }

  let response;
  try {
    response = await fetch(`${supabaseUrl.replace(/\/+$/, '')}/auth/v1/health`, {
      headers: {
        apikey: publishableKey,
        Accept: 'application/json',
      },
    });
  } catch {
    throw new Error('Could not reach Supabase (network error). Check your network and project URL.');
  }

  if (!response.ok) {
    let errorCode = '';
    let errorMessage = '';
    try {
      const body = await response.json();
      if (typeof body.code === 'string') errorCode = body.code;
      else if (typeof body.error_code === 'string') errorCode = body.error_code;
      if (typeof body.message === 'string') errorMessage = body.message;
      else if (typeof body.msg === 'string') errorMessage = body.msg;
      else if (typeof body.error_description === 'string') errorMessage = body.error_description;
    } catch {
      // Some gateway errors do not return JSON.
    }

    // Avoid accidentally echoing configuration values if an upstream error
    // includes request details in its response body.
    for (const secretValue of [supabaseUrl, publishableKey]) {
      if (secretValue) {
        errorCode = errorCode.split(secretValue).join('[redacted]');
        errorMessage = errorMessage.split(secretValue).join('[redacted]');
      }
    }

    const details = [errorCode && `code ${errorCode}`, errorMessage || response.statusText]
      .filter(Boolean)
      .join(': ');
    throw new Error(`Supabase health check failed (HTTP ${response.status})${details ? `: ${details}` : '.'}`);
  }

  return true;
}
