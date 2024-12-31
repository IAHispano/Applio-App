import { sendNotification } from "@tauri-apps/plugin-notification";
import { Store } from "@tauri-apps/plugin-store";

export const sendNotificationUtil = async (title: string, body: string) => {
	const store = await Store.load("settings.json");
	const notifications = await store.get("notifications");
	if (notifications === true) {
		sendNotification({
			title: title,
			body: body,
			icon: "../../src-tauri/icons/icon.ico",
		});
	}
};
