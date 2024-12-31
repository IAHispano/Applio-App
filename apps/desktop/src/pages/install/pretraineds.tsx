import { useEffect, useState } from "react";
import Background1 from "../../components/svg/background1";
import { useNavigate } from "react-router-dom";
import { getServerPort } from "../../utils/getBackendPort";

export default function DownloadPretraineds() {
	const [status, setStatus] = useState("Starting...");
	const [info, setInfo] = useState("Downloading...");
	const navigate = useNavigate();

	useEffect(() => {
		const installPretraineds = async () => {
			try {
				const port = await getServerPort();
				const eventSource = new EventSource(
					`http://localhost:${port}/pretraineds`,
				);

				eventSource.onmessage = (event) => {
					console.log(event.data);
					setStatus(event.data);

					if (event.data.includes("installed successfully")) {
						eventSource.close();
						setInfo("Finishing....");
						setStatus("Installing... please wait...");
						navigate("/");
						localStorage.removeItem("update");
					}
				};

				eventSource.onerror = (err) => {
					console.log(info);
					console.error("Error with event source:", err);
					eventSource.close();
					setStatus("");
					setInfo("We detected an error. Please try again later.");
				};

				return () => {
					eventSource.close();
				};
			} catch (error) {
				console.error("Error fetching port or setting up event source:", error);
				setInfo("We detected an error. Please try again later.");
			}
		};

		installPretraineds();
	}, [info]);

	return (
		<section className="absolute inset-0 z-50">
			<div className="w-screen h-screen absolute inset-0 bg-[#111111] pointer-events-none">
				<Background1 />
			</div>
			<div className="absolute inset-0 mt-auto flex z-50">
				<div className="z-50 flex flex-col w-full justify-center items-center mx-auto">
					<h1 className="font-bold text-4xl lg:text-5xl xl:text-6xl title">
						Downloading pretraineds
					</h1>
					<p className="text-white/80 text-sm mt-1">
						We need to install some more data to complete the installation.
					</p>
					<div className="flex flex-col justify-center items-center mx-auto w-full gap-2 my-4">
						{status && (
							<span className="px-4 py-2 text-center w-full h-fit max-w-sm bg-[#111111]/20 backdrop-filter backdrop-blur-xl rounded-full border border-white/10 text-xs truncate shadow-2xl shadow-white/20">
								{status}
							</span>
						)}
						{!info.includes("error") && (
							<span className="text-[10px] text-center text-neutral-300">
								{info}
							</span>
						)}
						{info.includes("error") && (
							<span className="text-xs text-center px-4 py-1 rounded-xl bg-red-500/20 border border-white/10 text-white">
								{info}
							</span>
						)}
					</div>
				</div>
			</div>
		</section>
	);
}
