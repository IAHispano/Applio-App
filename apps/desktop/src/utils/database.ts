import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const apiKey = import.meta.env.VITE_API_KEY;
const apiUrl = import.meta.env.VITE_API_URL;

let supabase: SupabaseClient | undefined;

if (!apiKey || !apiUrl) {
    console.warn('Supabase API key or URL is missing. Supabase client will not be initialized.');
} else {
    try {
        const validUrl = new URL(apiUrl);
        supabase = createClient(validUrl.toString(), apiKey); 
    } catch (error) {
        console.error('Invalid URL:', apiUrl);
        console.error('Error details:', error);
    }
}

export { supabase };
