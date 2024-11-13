import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const apiKey = import.meta.env.VITE_API_KEY;
const apiUrl = import.meta.env.VITE_API_URL;
let supabase: SupabaseClient | undefined;

if (!apiKey || !apiUrl) {
	console.warn(
		"Supabase API key or URL is missing. Please check your .env file.",
		{
			apiKey: apiKey ? "Present" : "Missing",
			apiUrl: apiUrl ? "Present" : "Missing",
		},
	);
} else {
	try {
		if (!apiUrl.startsWith("https://")) {
			throw new Error("URL must start with https://");
		}

		if (!apiUrl.endsWith(".supabase.co")) {
			throw new Error("URL must end with .supabase.co");
		}

		const validUrl = new URL(apiUrl);
		supabase = createClient(validUrl.toString(), apiKey, {
			auth: { persistSession: true },
		});
		console.log("Supabase client initialized successfully");
	} catch (error) {
		console.error("Error initializing Supabase client:");
		console.error("API URL:", apiUrl);
		console.error("Error details:", error);
	}
}

export { supabase };
