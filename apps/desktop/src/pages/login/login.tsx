import type { Provider } from "@supabase/supabase-js";
import { DiscordIcon, GitHubIcon, GoogleIcon } from "../../components/layout/header";
import { supabase } from "../../utils/database";
import { open } from "@tauri-apps/plugin-shell";
import { useEffect, useState } from "react";
import { cancel, onUrl, start } from "@fabianlars/tauri-plugin-oauth";

export default function Login() {
	const [authPort, setAuthPort] = useState<number | undefined>();
	const [logged, setLogged] = useState(false);

    useEffect(() => {
        async function startServer() {
            await startOAuthServer();
        }

        startServer();
    }, []);

    async function stopOAuthServer(port: number) {
        try {
          await cancel(port);
          console.log('OAuth server stopped');
        } catch (error) {
          console.error('Error stopping OAuth server:', error);
        }
      }
      
    async function startOAuthServer() {
		if (authPort) return;
		if (logged) return;
        if (!logged && !authPort) {
            const port = await start({response: 'You can now close this window and return to the application.'});
            setAuthPort(port);
            console.log(`OAuth server started on port ${port}`);
        
            // Set up listeners for OAuth results
            await onUrl((url) => {
            console.log('Received OAuth URL:', url);
            setLogged(true);
            setSessionData(url);
            });
        
            // Initiate your OAuth flow here
            // ...
        }
	  }

      async function setSessionData(url: string) {
        stopOAuthServer(authPort as number);
		supabase?.auth.setSession({
			access_token: url.split('access_token=')[1].split('&')[0],
			refresh_token: url.split('refresh_token=')[1].split('&')[0]
		})
		.then(({ data, error }) => {
			if (error) {
				console.error('Error setting session:', error);
				return;
			}
			if (data) {
				window.location.reload();
			}
		})
	}

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
                <h1 className="text-4xl font-semibold title">Logging for use Applio App</h1>
                <h2 className="text-neutral-300 max-w-xl">This program still in development and only its available for invited testers. We need your login for see if you are invited.</h2>
            <div className="mt-auto max-w-3xl flex flex-col gap-2">
            <p className="text-sm text-neutral-300">Continue with</p>
            <div className="w-full grid grid-cols-3 gap-4">
            <button type="button" className="w-full h-full rounded-xl bg-neutral-700 py-2 flex flex-col justify-center items-center hover:bg-neutral-600 transition-colors duration-200" onClick={() => handleLogin("github")}>
            <GitHubIcon />
            </button>
            <button type="button" className="w-full h-full rounded-xl bg-neutral-700 py-2 flex flex-col justify-center items-center hover:bg-neutral-600 transition-colors duration-200" onClick={() => handleLogin("discord")}>
            <DiscordIcon />
            </button>
            <button type="button" className="w-full h-full rounded-xl bg-neutral-700 py-2 flex flex-col justify-center items-center hover:bg-neutral-600 transition-colors duration-200" onClick={() => handleLogin("google")}>
            <GoogleIcon />
            </button>
            </div>
            </div>
            </div>
		</div>
	);
}