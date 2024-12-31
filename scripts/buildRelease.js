const { execSync } = require("child_process");
const path = require("path");
const fs = require("fs");

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

function getPackageVersion() {
	const packageJsonPath = path.resolve(
		__dirname,
		"../apps/desktop/package.json",
	);
	const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, "utf8"));
	return packageJson.version;
}

try {
	log("Starting the build process...", COLORS.green, true);

	const scriptsDir = __dirname;
	const buildDir = path.resolve(scriptsDir, "../build");
	const version = getPackageVersion();
	const versionDir = path.resolve(buildDir, version);
	const pythonBuildDir = path.resolve(versionDir, "python");
	const tauriOutputDir = path.resolve(
		scriptsDir,
		"../apps/desktop/src-tauri/target/release",
	);
	const tauriPythonDir = path.resolve(
		scriptsDir,
		"../apps/desktop/src-tauri/python",
	);

	log(`Creating version directory: ${version}`, COLORS.cyan);
	ensureDirExists(versionDir);
	ensureDirExists(pythonBuildDir);

	log("Building app...", COLORS.green, true);
	const start = Date.now();
	execSync("dotenv -- pnpm tauri build", {
		stdio: "inherit",
		cwd: path.resolve(scriptsDir, "../apps/desktop"),
	});

	log("Copying Tauri executable to version directory...", COLORS.cyan);
	const tauriExecutable = path.resolve(tauriOutputDir, "applio-app.exe");
	const tauriTargetPath = path.resolve(versionDir, "applio-app.exe");
	execSync(`copy ${tauriExecutable} ${tauriTargetPath}`, { stdio: "inherit" });

	log("Building backend...", COLORS.green, true);
	execSync("node scripts/buildBackend.js", {
		stdio: "inherit",
		cwd: path.resolve(scriptsDir, "../"),
	});

	log("Copying backend executable to version directories...", COLORS.cyan);
	const serverExecutable = path.resolve(
		scriptsDir,
		"../apps/server/dist/server.exe",
	);
	execSync(`copy ${serverExecutable} ${pythonBuildDir}\\server.exe`, {
		stdio: "inherit",
	});
	execSync(`copy ${serverExecutable} ${tauriPythonDir}\\server.exe`, {
		stdio: "inherit",
	});

	const duration = ((Date.now() - start) / 1000).toFixed(2);
	log(
		`Build process completed successfully in ${duration}s`,
		COLORS.green,
		true,
	);
} catch (error) {
	log(`Error during the build process: ${error.message}`, COLORS.red, true);
	process.exit(1);
}
