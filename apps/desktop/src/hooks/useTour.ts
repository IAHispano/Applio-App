import { Store } from "@tauri-apps/plugin-store";
import { useEffect, useState } from "react";

const useTourEffect = (loadingModels: boolean, tour: () => void) => {
	const [_animateTours, setAnimateTours] = useState(false);

	const initializeStoreDefaults = async (
		store: any,
		defaults: Record<string, any>,
	) => {
		let updated = false;
		for (const [key, value] of Object.entries(defaults)) {
			const currentValue = await store.get(key);
			if (currentValue === undefined) {
				store.set(key, value);
				updated = true;
			}
		}
		if (updated) await store.save();
	};

	const shouldShowTour = async (): Promise<boolean> => {
		const store = await Store.load("settings.json");
		await initializeStoreDefaults(store, { tours: true, animateTours: true });

		const showTour = await store.get("tours");
		const shouldAnimate = await store.get("animateTours");

		setAnimateTours(!!shouldAnimate);
		console.log("setting animateTours", !!shouldAnimate);

		return !!showTour;
	};

	const startTour = async () => {
		const store = await Store.load("tours.json");
		const shouldShow = await store.get("shouldShowUVR");

		if (shouldShow === true || shouldShow === undefined) {
			console.log("Tour started");
			tour();
			store.set("shouldShowUVR", false);
			await store.save();
		} else {
			console.log("Tour skipped");
		}

		console.log("showTour", shouldShow);
	};

	useEffect(() => {
		if (!loadingModels) {
			shouldShowTour().then((showTour) => {
				if (showTour) startTour();
			});
		}
	}, [loadingModels]);
};

export default useTourEffect;
