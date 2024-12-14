import { useEffect, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { supabase } from "../../utils/database";
import { useConvertContext } from "../convert/conversion-context";
import { ArrowDownToLine, ArrowLeft, ArrowRight, Bolt, FileAudio2, House, Import, Library, Sparkles } from "lucide-react";

export default function Sidebar() {
	const [isExpanded, setIsExpanded] = useState(false);
	const [updateAvailable, setUpdateAvailable] = useState(false);
	const { info } = useConvertContext();
	const navigate = useNavigate();
	const {pathname} = useLocation();

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
								className="flex items-center justify-start space-x-3 p-2 rounded-lg hover:bg-white/10 transition-colors duration-200 opacity-70"
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
						className={`mb-4 p-2 ${
							isExpanded ? "px-4 w-full text-center justify-center " : ""
						} flex m-auto rounded-full bg-neutral-700/50 hover:bg-neutral-700/20 border border-white/10 shadow-xl shadow-white/10 hover:saturate-200 slow transition-colors duration-200`}
					>
						{!isExpanded && <ArrowDownToLine />}
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
							className={`p-2 ${
								isExpanded
									? "justify-start items-start"
									: "justify-center items-center"
							} flex m-auto rounded-full bg-gradient-to-t from-transparent to-[#00AA68]/40 hover:saturate-200 slow transition-colors duration-200`}
							aria-label="Convert"
						>
							<Sparkles className="opacity-70 w-5 h-5"/>
						</Link>
					)}
				<div
					className={`flex items-center ${
						isExpanded ? "justify-start" : "justify-center flex-col"
					} gap-2 mb-4`}
				>
					<button
						type="button"
						className={`flex gap-2 items-center ${
							isExpanded ? "px-4 w-full text-center justify-center " : ""
						} p-2 rounded-full bg-white/10 hover:bg-white/20 transition-colors duration-200`}
						onClick={handleClick}
						aria-label={isExpanded ? "Collapse sidebar" : "Expand sidebar"}
					>
						{isExpanded ? <ArrowLeft className="opacity-70"/> : <ArrowRight className="opacity-70" />}
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
								className={`p-2 ${
									isExpanded
										? "justify-start items-start"
										: "justify-center items-center"
								} flex m-auto rounded-full bg-gradient-to-t from-transparent to-[#00AA68]/40 hover:saturate-200 slow transition-colors duration-200`}
								aria-label="Convert"
							>
								<Sparkles className="opacity-70 w-5 h-5"/>
							</Link>
						)}
					{!isExpanded && userInfo && (
						<img
							src={userInfo.avatar_url}
							alt="User avatar"
							className="w-9 h-9 rounded-full"
						/>
					)}
				</div>
				{isExpanded && (
					<>
						{userInfo ? (
							<div
								className="flex items-center space-x-3 px-4 py-3 bg-white/10 rounded-lg"
								onClick={logout}
							>
								<img
									src={userInfo.avatar_url}
									alt="User avatar"
									className="w-10 h-10 rounded-full"
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
								className="w-full h-full rounded-xl bg-neutral-700 py-2 flex flex-col justify-center items-center hover:bg-neutral-600 transition-colors duration-200"
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
