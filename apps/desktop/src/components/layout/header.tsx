import { useEffect, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { supabase } from "../../utils/database";
import { useConvertContext } from "../convert/conversion-context";
import {
	ArrowDownToLine,
	ArrowLeft,
	ArrowRight,
	Bolt,
	FileAudio2,
	House,
	Import,
	Library,
	Sparkles,
} from "lucide-react";
import { motion } from "framer-motion";
import { useUVR } from "../audio-editor/uvrcontext";

export default function Sidebar() {
	const [isExpanded, setIsExpanded] = useState(false);
	const [updateAvailable, setUpdateAvailable] = useState(false);
	const [dominantColor, setDominantColor] = useState("");
	const { info } = useConvertContext();
	const { UVRinfo } = useUVR();
	const navigate = useNavigate();
	const { pathname } = useLocation();

	const [userInfo, setUserInfo] = useState<any>();

	const menuItems = [
		{ icon: <House />, label: "Home", to: "/" },
		{ icon: <Import />, label: "Models", to: "/models" },
		{ icon: <Sparkles />, label: "Convert", to: "/convert" },
		{ icon: <Library />, label: "Library", to: "/inferences" },
		{ icon: <FileAudio2 />, label: "Audio Editor", to: "/audio-editor" },
		{ icon: <Bolt />, label: "Settings", to: "/settings" },
	];

	const handleClick = () => {
		setIsExpanded(!isExpanded);
		localStorage.setItem("sidebar-expanded", `${!isExpanded}`);
	};

	useEffect(() => {
		const expanded = localStorage.getItem("sidebar-expanded");
		if (expanded) {
			setIsExpanded(expanded === "true");
		}
	}, []);

	useEffect(() => {
		async function getUser() {
			const user = await supabase?.auth.getSession();
			if (user && user?.data.session) {
				supabase
					?.from("profiles")
					.select("*")
					.eq("auth_id", user.data.session.user.id)
					.single()
					.then(({ data, error }) => {
						if (error) {
							console.error("Error fetching user profile:", error);
							return;
						}
						if (data) {
							setUserInfo(data);
						}
					});
			}
		}

		getUser();
	}, []);

	const logout = async () => {
		await supabase?.auth.signOut();
		localStorage.removeItem("logged");
		localStorage.removeItem("authPort");
		navigate(0);
	};

	useEffect(() => {
		async function checkUpdates() {
			const update = localStorage.getItem("update");
			if (update) {
				setUpdateAvailable(true);
			} else {
				setUpdateAvailable(false);
			}
		}

		checkUpdates();
	}, [pathname]);

	useEffect(() => {
		if (userInfo?.avatar_url) {
			const img = new Image();
			img.crossOrigin = "Anonymous";
			img.src = userInfo.avatar_url;
			img.onload = () => {
				const canvas = document.createElement("canvas");
				const ctx = canvas.getContext("2d");
				if (ctx) {
					canvas.width = img.width;
					canvas.height = img.height;
					ctx.drawImage(img, 0, 0);
					const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
					const data = imageData.data;
					let r = 0,
						g = 0,
						b = 0;
					let total = data.length / 4;
					for (let i = 0; i < data.length; i += 4) {
						r += data[i];
						g += data[i + 1];
						b += data[i + 2];
					}
					r = Math.floor(r / total);
					g = Math.floor(g / total);
					b = Math.floor(b / total);
					setDominantColor(`rgb(${r}, ${g}, ${b})`);
				}
			};
		}
	}, [userInfo?.avatar_url]);

	return (
		<div
			className={`flex flex-col mt-10 bg-[#1c1c1c]/10 border border-white/10 text-gray-100 p-4 m-4 mr-0 rounded-xl transition-all duration-300 ease-in-out ${
				isExpanded ? "w-64" : "w-20"
			}`}
			style={{ zIndex: 200 }}
		>
			<nav className="flex-1">
				<ul className="space-y-2">
					{menuItems.map((item, index) => (
						<li key={index}>
							<Link
								to={item.to}
								className={`flex items-center justify-start space-x-3 p-2.5 rounded-lg ${pathname === item.to ? "bg-white/10" : ""} hover:bg-white/10 transition-colors duration-200 opacity-70`}
							>
								{item.icon}
								{isExpanded && <span>{item.label}</span>}
							</Link>
						</li>
					))}
				</ul>
			</nav>

			<div className="mt-auto flex flex-col gap-2">
				{updateAvailable && (
					<Link
						to="/first-time"
						className={`p-2 my-2 ${
							isExpanded ? "px-4 w-full text-center justify-center" : ""
						} flex m-auto rounded-xl bg-neutral-700/50 hover:bg-neutral-700/20 border border-white/10 shadow-xl shadow-white/10 hover:saturate-200 slow transition-colors duration-200`}
					>
						{!isExpanded && <ArrowDownToLine className="opacity-70" />}
						{isExpanded && (
							<span className="text-sm text-neutral-300">
								Update available!
							</span>
						)}
					</Link>
				)}

				{!isExpanded &&
					!info.includes("completed") &&
					!info.includes("error") &&
					info && (
						<Link
							to="/convert"
							className="p-2 flex justify-center items-center rounded-xl bg-gradient-to-t from-transparent shadow-[#00AA68]/10 shadow-xl to-[#00AA68]/40 hover:saturate-200 slow transition-colors duration-200"
							aria-label="Convert"
						>
							<Sparkles className="opacity-70 w-5 h-5" />
						</Link>
					)}
				{!isExpanded &&
					!UVRinfo.includes("completed") &&
					!UVRinfo.includes("error") &&
					UVRinfo &&
					!info && (
						<Link
							to="/convert"
							className="p-2 flex justify-center items-center rounded-xl bg-gradient-to-t from-transparent shadow-[#00AA68]/10 shadow-xl to-[#00AA68]/40 hover:saturate-200 slow transition-colors duration-200"
							aria-label="Convert"
						>
							<Sparkles className="opacity-70 w-5 h-6" />
						</Link>
					)}

				<div className="flex flex-col gap-2">
					<div className="flex gap-2 w-full">
						<button
							type="button"
							className={`flex gap-2 items-center ${
								isExpanded ? "px-4 w-full justify-center" : "justify-center"
							} p-2 rounded-xl border-white/10 border hover:bg-white/10 transition-colors duration-200`}
							onClick={handleClick}
							aria-label={isExpanded ? "Collapse sidebar" : "Expand sidebar"}
						>
							{isExpanded ? (
								<ArrowLeft className="opacity-60" />
							) : (
								<ArrowRight className="opacity-60" />
							)}
							{isExpanded && (
								<span className="text-sm text-neutral-300">Collapse</span>
							)}
						</button>

						{isExpanded &&
							!info.includes("completed") &&
							!info.includes("error") &&
							info && (
								<Link
									to="/convert"
									className="p-2.5 flex justify-center items-center rounded-xl bg-gradient-to-t from-transparent to-[#00AA68]/40 hover:saturate-200 slow transition-colors duration-200"
									aria-label="Convert"
								>
									<Sparkles className="opacity-70 w-5 h-5" />
								</Link>
							)}
						{isExpanded &&
							!UVRinfo.includes("completed") &&
							!UVRinfo.includes("error") &&
							UVRinfo &&
							!info && (
								<Link
									to="/convert"
									className="p-2.5 flex justify-center items-center rounded-xl bg-gradient-to-t from-transparent to-[#00AA68]/40 hover:saturate-200 slow transition-colors duration-200"
									aria-label="Convert"
								>
									<Sparkles className="opacity-70 w-5 h-5" />
								</Link>
							)}
					</div>

					{!isExpanded && userInfo && (
						<motion.img
							src={userInfo.avatar_url}
							alt="User avatar"
							className="w-10 h-10 rounded-xl mx-auto mt-2"
							initial={{
								boxShadow: "0 0 0px 0px transparent",
							}}
							animate={{
								boxShadow: dominantColor
									? `0 0 10px 2px ${dominantColor}`
									: "none",
							}}
							transition={{
								duration: 0.5,
							}}
						/>
					)}
				</div>

				{isExpanded && (
					<>
						{userInfo ? (
							<div
								className="flex items-center justify-center m-auto w-full px-4 py-2 mt-2 space-x-3 border border-white/10 rounded-xl cursor-pointer"
								onClick={logout}
							>
								<img
									src={userInfo.avatar_url}
									alt="User avatar"
									className="w-10 h-10 rounded-xl"
								/>
								<div className="flex-1 truncate">
									<p className="font-semibold title">{userInfo.full_name}</p>
									<p className="text-sm text-gray-400">
										@{userInfo.discord_username || userInfo.full_name}
									</p>
								</div>
							</div>
						) : (
							<Link
								to="/login"
								className="w-full rounded-xl bg-neutral-700 py-2 flex justify-center items-center hover:bg-neutral-600 transition-colors duration-200"
							>
								Login
							</Link>
						)}
					</>
				)}
			</div>
		</div>
	);
}
