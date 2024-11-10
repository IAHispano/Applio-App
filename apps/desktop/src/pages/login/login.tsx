import type { Provider } from "@supabase/supabase-js";
import { DiscordIcon, GitHubIcon, GoogleIcon } from "../../components/layout/header";
import { supabase } from "../../utils/database";
import { open } from "@tauri-apps/plugin-shell";
import { useEffect } from "react";

type LoginProps = {
    authPort: number | undefined;
};

export default function Login({ authPort }: LoginProps) {
	const handleLogin = async (provider: string) => {
		if (provider && authPort) {
		const data = await supabase?.auth.signInWithOAuth({provider: provider as Provider, options: { skipBrowserRedirect: true, redirectTo: `http://localhost:${authPort}` }});
		if (data?.data.url) {
			open(data.data.url);
		} else {
			alert(data?.error?.message);
		}
		}  else {
			alert("Error: OAuth server not found, please report error.");
		}
	};

    useEffect(() => {
        async function getUser() {
            const user = await supabase?.auth.getSession();
            if (user?.data.session) {
                window.location.href = "/";
            } 
        }

        getUser();
    }, []);

	return (
		<div className="w-screen h-screen flex flex-col justify-center items-center bg-[#2a2b2a]/50">
			<div className="w-full h-full flex flex-col p-24">
                <h1 className="text-4xl font-semibold title">Loggin for use Applio App</h1>
                <h2 className="text-neutral-300 max-w-xl">This program still in development and only its available for invited testers. We need your login for see if you are invited.</h2>
            <div className="mt-auto max-w-3xl flex flex-col gap-2">
            <p className="text-sm text-neutral-300">Continue with</p>
            <div className="w-full grid grid-cols-3 gap-4">
            <button className="w-full h-full rounded-xl bg-neutral-700 py-2 flex flex-col justify-center items-center hover:bg-neutral-600 transition-colors duration-200" onClick={() => handleLogin("github")}>
            <GitHubIcon />
            </button>
            <button className="w-full h-full rounded-xl bg-neutral-700 py-2 flex flex-col justify-center items-center hover:bg-neutral-600 transition-colors duration-200" onClick={() => handleLogin("discord")}>
            <DiscordIcon />
            </button>
            <button className="w-full h-full rounded-xl bg-neutral-700 py-2 flex flex-col justify-center items-center hover:bg-neutral-600 transition-colors duration-200" onClick={() => handleLogin("google")}>
            <GoogleIcon />
            </button>
            </div>
            </div>
            </div>
		</div>
	);
}