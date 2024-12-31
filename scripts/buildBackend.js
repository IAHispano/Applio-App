const { execSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const COLORS = {
	reset: "\x1b[0m",
	red: "\x1b[31m",
	green: "\x1b[32m",
	cyan: "\x1b[36m",
	bold: "\x1b[1m",
};

function log(message, color = COLORS.cyan, bold = false) {
	const style = bold ? COLORS.bold : "";
	console.log(`${style}${color}${message}${COLORS.reset}`);
}

function ensureDirExists(dir) {
	if (!fs.existsSync(dir)) {
		fs.mkdirSync(dir, { recursive: true });
	}
}

try {
	log("Starting...", COLORS.green, true);

	const scriptsDir = __dirname;
	const buildDir = path.resolve(scriptsDir, "../build/python");
	const tauriDir = path.resolve(scriptsDir, "../apps/desktop/src-tauri/python");
	const pythonPath = path.resolve(
		scriptsDir,
		"../apps/server/env/Scripts/python.exe",
	);

	log("Checking if build directory exists...", COLORS.cyan);
	ensureDirExists(buildDir);
	ensureDirExists(tauriDir);

	log("Checking Python environment...", COLORS.cyan);
	try {
		log("Python version:", COLORS.cyan);
		execSync(`${pythonPath} -V`, { stdio: "inherit" });
		log("\nInstalled packages:", COLORS.cyan);
		execSync(`${pythonPath} -m pip list`, { stdio: "inherit" });
	} catch (error) {
		log("Failed to get Python environment info", COLORS.red, true);
		throw error;
	}

	log("Building backend...", COLORS.green, true);
	const start = new Date();

	try {
		// log('Ensuring PyInstaller is installed...', COLORS.cyan);
		// execSync(`${pythonPath} -m pip install pyinstaller`, { stdio: 'inherit' });

		const pyinstallerPath = path.resolve(
			scriptsDir,
			"../apps/server/env/Scripts/pyinstaller.exe",
		);
		execSync(
			`${pyinstallerPath} --onefile --icon=logo.ico --noconsole --add-data ".env;." server.py`,
			{
				stdio: "inherit",
				cwd: "./apps/server",
			},
		);
		log("Receiving backend build output...", COLORS.cyan);
	} catch (pyinstallerError) {
		log(
			"Error: You should install required dependencies before building the backend. Use `install.bat` to install them.",
			COLORS.red,
			true,
		);
		process.exit(1);
	}

	log("Copying backend to build directory...", COLORS.cyan);
	execSync("copy dist\\server.exe ..\\..\\build\\python\\server.exe", {
		stdio: "inherit",
		cwd: "./apps/server",
	});

	log("Copying backend to desktop directory...", COLORS.cyan);
	execSync("copy dist\\server.exe ..\\desktop\\src-tauri\\python\\server.exe", {
		stdio: "inherit",
		cwd: "./apps/server",
	});

	const duration = ((Date.now() - start) / 1000).toFixed(2);
	log(
		`Backend build process completed successfully in ${duration}s.`,
		COLORS.green,
		true,
	);
} catch (error) {
	log(`Error building backend: ${error}`, COLORS.red, true);
	process.exit(1);
}
