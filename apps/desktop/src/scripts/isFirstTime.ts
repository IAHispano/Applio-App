import { Store } from "@tauri-apps/plugin-store";

async function checkFirstRun(): Promise<boolean> {
	try {
		const store = await Store.load("firstRun");
		const isFirstRun = await store.get("firstRun");

		console.log("isFirstRun:", isFirstRun);
		if (isFirstRun === null || isFirstRun === undefined) {
			await store.set("firstRun", true);
			await store.save();
			return true;
		}
	} catch (error) {
		console.error("Error verifying first run:", error);
		return false;
	}
	return false;
}

async function isFirstRun(): Promise<boolean> {
	return await checkFirstRun();
}

async function setNotFirstRun(): Promise<boolean> {
	try {
		const store = await Store.load("firstRun");
		await store.set("firstRun", false);
		await store.save();
		return true;
	} catch (error) {
		console.error("Error setting first run:", error);
		return false;
	}
}

export { checkFirstRun, isFirstRun, setNotFirstRun };
