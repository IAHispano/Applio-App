import { defineConfig } from "vite";

const host = process.env.TAURI_DEV_HOST;

export default defineConfig({
	// prevent vite from obscuring rust errors
	clearScreen: false,
	server: {
		// Tauri expects a fixed port, fail if that port is not available
		strictPort: true,
		// if the host Tauri is expecting is set, use it
		host: host || false,
		port: 1420,
		watch: {
			ignored: [
				"./src-tauri/python/**",
				"**/.git/**",
				"**/node_modules/**",
				"**/.cache/**",
			],
		},
	},
	// to access the Tauri environment variables set by the CLI with information about the current target
	envPrefix: ["VITE_", "TAURI_ENV_*"],
	build: {
		// Tauri uses Chromium on Windows and WebKit on macOS and Linux
		target:
			process.env.TAURI_ENV_PLATFORM == "windows" ? "chrome105" : "safari13",
		// don't minify for debug builds
		minify: !process.env.TAURI_ENV_DEBUG ? "esbuild" : false,
		// produce sourcemaps for debug builds
		sourcemap: !!process.env.TAURI_ENV_DEBUG,
		// optimizations for production builds
		rollupOptions: {
			output: {
				manualChunks: {
					vendor: ["react", "react-dom"],
				},
			},
		},
		reportCompressedSize: true,
		chunkSizeWarningLimit: 1000,
		commonjsOptions: {
			include: [/node_modules/],
			extensions: [".js", ".cjs"],
		},
	},
	optimizeDeps: {
		include: ["react", "react-dom"],
		exclude: ["@tauri-apps/api"],
	},
});
