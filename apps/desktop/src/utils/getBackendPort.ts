import { invoke } from "@tauri-apps/api/core";

// get server port
export async function getServerPort() {
	const port = await invoke("get_port");
	console.log("port", port);
	return port;
}
