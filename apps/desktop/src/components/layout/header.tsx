import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useConvertContext } from "../convert/conversion-context";
import { supabase } from "../../utils/database";

export const GitHubIcon = () => {
	return (
	  <svg className="w-4 h-4" aria-hidden="true" viewBox="0 -3.5 256 256" xmlns="http://www.w3.org/2000/svg" preserveAspectRatio="xMinYMin meet" fill="#000000"><g id="SVGRepo_bgCarrier" stroke-width="0"></g><g id="SVGRepo_tracerCarrier" stroke-linecap="round" stroke-linejoin="round"></g><g id="SVGRepo_iconCarrier"> <g fill="#f5f5f5"> <path d="M127.505 0C57.095 0 0 57.085 0 127.505c0 56.336 36.534 104.13 87.196 120.99 6.372 1.18 8.712-2.766 8.712-6.134 0-3.04-.119-13.085-.173-23.739-35.473 7.713-42.958-15.044-42.958-15.044-5.8-14.738-14.157-18.656-14.157-18.656-11.568-7.914.872-7.752.872-7.752 12.804.9 19.546 13.14 19.546 13.14 11.372 19.493 29.828 13.857 37.104 10.6 1.144-8.242 4.449-13.866 8.095-17.05-28.32-3.225-58.092-14.158-58.092-63.014 0-13.92 4.981-25.295 13.138-34.224-1.324-3.212-5.688-16.18 1.235-33.743 0 0 10.707-3.427 35.073 13.07 10.17-2.826 21.078-4.242 31.914-4.29 10.836.048 21.752 1.464 31.942 4.29 24.337-16.497 35.029-13.07 35.029-13.07 6.94 17.563 2.574 30.531 1.25 33.743 8.175 8.929 13.122 20.303 13.122 34.224 0 48.972-29.828 59.756-58.22 62.912 4.573 3.957 8.648 11.717 8.648 23.612 0 17.06-.148 30.791-.148 34.991 0 3.393 2.295 7.369 8.759 6.117 50.634-16.879 87.122-64.656 87.122-120.973C255.009 57.085 197.922 0 127.505 0"></path> <path d="M47.755 181.634c-.28.633-1.278.823-2.185.389-.925-.416-1.445-1.28-1.145-1.916.275-.652 1.273-.834 2.196-.396.927.415 1.455 1.287 1.134 1.923M54.027 187.23c-.608.564-1.797.302-2.604-.589-.834-.889-.99-2.077-.373-2.65.627-.563 1.78-.3 2.616.59.834.899.996 2.08.36 2.65M58.33 194.39c-.782.543-2.06.034-2.849-1.1-.781-1.133-.781-2.493.017-3.038.792-.545 2.05-.055 2.85 1.07.78 1.153.78 2.513-.019 3.069M65.606 202.683c-.699.77-2.187.564-3.277-.488-1.114-1.028-1.425-2.487-.724-3.258.707-.772 2.204-.555 3.302.488 1.107 1.026 1.445 2.496.7 3.258M75.01 205.483c-.307.998-1.741 1.452-3.185 1.028-1.442-.437-2.386-1.607-2.095-2.616.3-1.005 1.74-1.478 3.195-1.024 1.44.435 2.386 1.596 2.086 2.612M85.714 206.67c.036 1.052-1.189 1.924-2.705 1.943-1.525.033-2.758-.818-2.774-1.852 0-1.062 1.197-1.926 2.721-1.951 1.516-.03 2.758.815 2.758 1.86M96.228 206.267c.182 1.026-.872 2.08-2.377 2.36-1.48.27-2.85-.363-3.039-1.38-.184-1.052.89-2.105 2.367-2.378 1.508-.262 2.857.355 3.049 1.398"></path> </g> </g></svg>
	)}
  
  export const DiscordIcon = () => {
	return (
	  <svg className="w-4 h-4" fill="#ffffff" viewBox="0 0 32 32" version="1.1" xmlns="http://www.w3.org/2000/svg"><g id="SVGRepo_bgCarrier" stroke-width="0"></g><g id="SVGRepo_tracerCarrier" stroke-linecap="round" stroke-linejoin="round"></g><g id="SVGRepo_iconCarrier"> <title>discord</title> <path d="M20.992 20.163c-1.511-0.099-2.699-1.349-2.699-2.877 0-0.051 0.001-0.102 0.004-0.153l-0 0.007c-0.003-0.048-0.005-0.104-0.005-0.161 0-1.525 1.19-2.771 2.692-2.862l0.008-0c1.509 0.082 2.701 1.325 2.701 2.847 0 0.062-0.002 0.123-0.006 0.184l0-0.008c0.003 0.050 0.005 0.109 0.005 0.168 0 1.523-1.191 2.768-2.693 2.854l-0.008 0zM11.026 20.163c-1.511-0.099-2.699-1.349-2.699-2.877 0-0.051 0.001-0.102 0.004-0.153l-0 0.007c-0.003-0.048-0.005-0.104-0.005-0.161 0-1.525 1.19-2.771 2.692-2.862l0.008-0c1.509 0.082 2.701 1.325 2.701 2.847 0 0.062-0.002 0.123-0.006 0.184l0-0.008c0.003 0.048 0.005 0.104 0.005 0.161 0 1.525-1.19 2.771-2.692 2.862l-0.008 0zM26.393 6.465c-1.763-0.832-3.811-1.49-5.955-1.871l-0.149-0.022c-0.005-0.001-0.011-0.002-0.017-0.002-0.035 0-0.065 0.019-0.081 0.047l-0 0c-0.234 0.411-0.488 0.924-0.717 1.45l-0.043 0.111c-1.030-0.165-2.218-0.259-3.428-0.259s-2.398 0.094-3.557 0.275l0.129-0.017c-0.27-0.63-0.528-1.142-0.813-1.638l0.041 0.077c-0.017-0.029-0.048-0.047-0.083-0.047-0.005 0-0.011 0-0.016 0.001l0.001-0c-2.293 0.403-4.342 1.060-6.256 1.957l0.151-0.064c-0.017 0.007-0.031 0.019-0.040 0.034l-0 0c-2.854 4.041-4.562 9.069-4.562 14.496 0 0.907 0.048 1.802 0.141 2.684l-0.009-0.11c0.003 0.029 0.018 0.053 0.039 0.070l0 0c2.14 1.601 4.628 2.891 7.313 3.738l0.176 0.048c0.008 0.003 0.018 0.004 0.028 0.004 0.032 0 0.060-0.015 0.077-0.038l0-0c0.535-0.72 1.044-1.536 1.485-2.392l0.047-0.1c0.006-0.012 0.010-0.027 0.010-0.043 0-0.041-0.026-0.075-0.062-0.089l-0.001-0c-0.912-0.352-1.683-0.727-2.417-1.157l0.077 0.042c-0.029-0.017-0.048-0.048-0.048-0.083 0-0.031 0.015-0.059 0.038-0.076l0-0c0.157-0.118 0.315-0.24 0.465-0.364 0.016-0.013 0.037-0.021 0.059-0.021 0.014 0 0.027 0.003 0.038 0.008l-0.001-0c2.208 1.061 4.8 1.681 7.536 1.681s5.329-0.62 7.643-1.727l-0.107 0.046c0.012-0.006 0.025-0.009 0.040-0.009 0.022 0 0.043 0.008 0.059 0.021l-0-0c0.15 0.124 0.307 0.248 0.466 0.365 0.023 0.018 0.038 0.046 0.038 0.077 0 0.035-0.019 0.065-0.046 0.082l-0 0c-0.661 0.395-1.432 0.769-2.235 1.078l-0.105 0.036c-0.036 0.014-0.062 0.049-0.062 0.089 0 0.016 0.004 0.031 0.011 0.044l-0-0.001c0.501 0.96 1.009 1.775 1.571 2.548l-0.040-0.057c0.017 0.024 0.046 0.040 0.077 0.040 0.010 0 0.020-0.002 0.029-0.004l-0.001 0c2.865-0.892 5.358-2.182 7.566-3.832l-0.065 0.047c0.022-0.016 0.036-0.041 0.039-0.069l0-0c0.087-0.784 0.136-1.694 0.136-2.615 0-5.415-1.712-10.43-4.623-14.534l0.052 0.078c-0.008-0.016-0.022-0.029-0.038-0.036l-0-0z"></path> </g></svg>
	)
  }
  
  export const GoogleIcon = () => {
	return (
		<svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><g id="SVGRepo_bgCarrier" stroke-width="0"></g><g id="SVGRepo_tracerCarrier" stroke-linecap="round" stroke-linejoin="round"></g><g id="SVGRepo_iconCarrier"> <path d="M19.76 10.77L19.67 10.42H12.23V13.58H16.68C16.4317 14.5443 15.8672 15.3974 15.0767 16.0029C14.2863 16.6084 13.3156 16.9313 12.32 16.92C11.0208 16.9093 9.77254 16.4135 8.81999 15.53C8.35174 15.0685 7.97912 14.5191 7.72344 13.9134C7.46777 13.3077 7.33407 12.6575 7.33 12C7.34511 10.6795 7.86792 9.41544 8.79 8.47002C9.7291 7.58038 10.9764 7.08932 12.27 7.10002C13.3779 7.10855 14.4446 7.52101 15.27 8.26002L17.47 6.00002C16.02 4.70638 14.1432 3.9941 12.2 4.00002C11.131 3.99367 10.0713 4.19793 9.08127 4.60115C8.09125 5.00436 7.19034 5.59863 6.43 6.35002C4.98369 7.8523 4.16827 9.85182 4.15152 11.9371C4.13478 14.0224 4.918 16.0347 6.34 17.56C7.12784 18.3449 8.06422 18.965 9.09441 19.3839C10.1246 19.8029 11.2279 20.0123 12.34 20C13.3484 20.0075 14.3479 19.8102 15.2779 19.42C16.2078 19.0298 17.0488 18.4549 17.75 17.73C19.1259 16.2171 19.8702 14.2347 19.83 12.19C19.8408 11.7156 19.8174 11.2411 19.76 10.77Z" fill="#ffffff"></path> </g></svg>
	)}

const icons = {
	Home: (
		<svg
			xmlns="http://www.w3.org/2000/svg"
			fill="none"
			viewBox="0 0 24 24"
			stroke="currentColor"
			className="w-6 h-6 opacity-70"
		>
			<path
				strokeLinecap="round"
				strokeLinejoin="round"
				strokeWidth={2}
				d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6"
			/>
		</svg>
	),
	Models: (
		<svg
			xmlns="http://www.w3.org/2000/svg"
			fill="none"
			viewBox="0 0 24 24"
			stroke="currentColor"
			className="w-6 h-6 opacity-70"
		>
			<path
				strokeLinecap="round"
				strokeLinejoin="round"
				strokeWidth={2}
				d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253"
			/>
		</svg>
	),
	Convert: (
		<svg
			xmlns="http://www.w3.org/2000/svg"
			fill="none"
			viewBox="0 0 24 24"
			stroke="currentColor"
			className="w-6 h-6 opacity-70"
		>
			<path
				strokeLinecap="round"
				strokeLinejoin="round"
				strokeWidth={2}
				d="M19.428 15.428a2 2 0 00-1.022-.547l-2.387-.477a6 6 0 00-3.86.517l-.318.158a6 6 0 01-3.86.517L6.05 15.21a2 2 0 00-1.806.547M8 4h8l-1 1v5.172a2 2 0 00.586 1.414l5 5c1.26 1.26.367 3.414-1.415 3.414H4.828c-1.782 0-2.674-2.154-1.414-3.414l5-5A2 2 0 009 10.172V5L8 4z"
			/>
		</svg>
	),
	Settings: (
		<svg
			className="w-6 h-6 opacity-70"
			viewBox="0 0 24 24"
			fill="none"
			xmlns="http://www.w3.org/2000/svg"
		>
			<g id="SVGRepo_bgCarrier" stroke-width="0"></g>
			<g
				id="SVGRepo_tracerCarrier"
				stroke-linecap="round"
				stroke-linejoin="round"
			></g>
			<g id="SVGRepo_iconCarrier">
				{" "}
				<g id="Interface / Settings_Future">
					{" "}
					<g id="Vector">
						{" "}
						<path
							d="M13.6006 21.0761L19.0608 17.9236C19.6437 17.5871 19.9346 17.4188 20.1465 17.1834C20.3341 16.9751 20.4759 16.7297 20.5625 16.4632C20.6602 16.1626 20.6602 15.8267 20.6602 15.1568V8.84268C20.6602 8.17277 20.6602 7.83694 20.5625 7.53638C20.4759 7.26982 20.3341 7.02428 20.1465 6.816C19.9355 6.58161 19.6453 6.41405 19.0674 6.08043L13.5996 2.92359C13.0167 2.58706 12.7259 2.41913 12.416 2.35328C12.1419 2.295 11.8584 2.295 11.5843 2.35328C11.2744 2.41914 10.9826 2.58706 10.3997 2.92359L4.93843 6.07666C4.35623 6.41279 4.06535 6.58073 3.85352 6.816C3.66597 7.02428 3.52434 7.26982 3.43773 7.53638C3.33984 7.83765 3.33984 8.17436 3.33984 8.84742V15.1524C3.33984 15.8254 3.33984 16.1619 3.43773 16.4632C3.52434 16.7297 3.66597 16.9751 3.85352 17.1834C4.06548 17.4188 4.35657 17.5871 4.93945 17.9236L10.3997 21.0761C10.9826 21.4126 11.2744 21.5806 11.5843 21.6465C11.8584 21.7047 12.1419 21.7047 12.416 21.6465C12.7259 21.5806 13.0177 21.4126 13.6006 21.0761Z"
							stroke="#f2f2f2"
							stroke-width="2"
							stroke-linecap="round"
							stroke-linejoin="round"
						></path>{" "}
						<path
							d="M9 11.9998C9 13.6566 10.3431 14.9998 12 14.9998C13.6569 14.9998 15 13.6566 15 11.9998C15 10.3429 13.6569 8.99976 12 8.99976C10.3431 8.99976 9 10.3429 9 11.9998Z"
							stroke="#f2f2f2"
							stroke-width="2"
							stroke-linecap="round"
							stroke-linejoin="round"
						></path>{" "}
					</g>{" "}
				</g>{" "}
			</g>
		</svg>
	),
	MoreHorizontal: (
		<svg
			xmlns="http://www.w3.org/2000/svg"
			fill="none"
			viewBox="0 0 24 24"
			stroke="currentColor"
			className="w-5 h-5 opacity-70"
		>
			<path
				strokeLinecap="round"
				strokeLinejoin="round"
				strokeWidth={2}
				d="M5 12h.01M12 12h.01M19 12h.01M6 12a1 1 0 11-2 0 1 1 0 012 0zm7 0a1 1 0 11-2 0 1 1 0 012 0zm7 0a1 1 0 11-2 0 1 1 0 012 0z"
			/>
		</svg>
	),
	ArrowRight: (
		<svg
			xmlns="http://www.w3.org/2000/svg"
			fill="none"
			viewBox="0 0 24 24"
			stroke="currentColor"
			className="w-5 h-5 opacity-70"
		>
			<path
				strokeLinecap="round"
				strokeLinejoin="round"
				strokeWidth={2}
				d="M14 5l7 7m0 0l-7 7m7-7H3"
			/>
		</svg>
	),
	ArrowLeft: (
		<svg
			xmlns="http://www.w3.org/2000/svg"
			fill="none"
			viewBox="0 0 24 24"
			stroke="currentColor"
			className="w-5 h-5 opacity-70"
		>
			<path
				strokeLinecap="round"
				strokeLinejoin="round"
				strokeWidth={2}
				d="M10 19l-7-7m0 0l7-7m-7 7h18"
			/>
		</svg>
	),
	Converting: (
		<svg
		className="w-5 h-5 opacity-70"
		viewBox="0 0 32 32"
		fill="#f8f8f8"
		stroke="#f8f8f8"
		aria-hidden="true"
	>
		<g id="SVGRepo_bgCarrier" strokeWidth="0" />
		<g id="SVGRepo_tracerCarrier" strokeLinecap="round" strokeLinejoin="round" />
		<g id="SVGRepo_iconCarrier">
			<g>
				<path
					className="st0"
					d="M17.9,9.9c-4.6,0.9-6,2.3-6.9,6.9c-0.9-4.6-2.3-6-6.9-6.9C8.7,9,10.1,7.6,11,3C11.9,7.6,13.3,9,17.9,9.9z"
				/>
			</g>
			<g>
				<path
					className="st0"
					d="M21.8,25c-3.2,0.6-4.1,1.6-4.8,4.8c-0.6-3.2-1.6-4.1-4.8-4.8c3.2-0.6,4.1-1.6,4.8-4.8 C17.6,23.4,18.6,24.4,21.8,25z"
				/>
			</g>
			<g>
				<path
					className="st0"
					d="M29,15c-2.6,0.5-3.4,1.3-3.9,3.9c-0.5-2.6-1.3-3.4-3.9-3.9c2.6-0.5,3.4-1.3,3.9-3.9C25.6,13.7,26.4,14.5,29,15 z"
				/>
			</g>
			<line className="st0" x1="5" y1="23" x2="5" y2="23" />
			<line className="st0" x1="28" y1="6" x2="28" y2="6" />
		</g>
	</svg>
	)
};

export default function Sidebar() {
	const [isExpanded, setIsExpanded] = useState(false);
	const {info} = useConvertContext();
	const navigate = useNavigate();

	const [userInfo, setUserInfo] = useState<any>();

	const menuItems = [
		{ icon: "Home", label: "Home", to: "/" },
		{ icon: "Models", label: "Models", to: "/models" },
		{ icon: "Convert", label: "Convert", to: "/convert" },
		{ icon: "Settings", label: "Settings", to: "/settings" },
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
			supabase?.from("profiles").select("*").eq("auth_id", user.data.session.user.id).single()
			.then(({ data, error }) => {
				if (error) {
					console.error('Error fetching user profile:', error);
					return;
				}
				if (data) {
					setUserInfo(data);
				}
			})
		} else {
			if (window.location.pathname !== '/login') {
				navigate('/login');
			}
		}
	}

	getUser();
	}, []);

	const logout = async () => {
		await supabase?.auth.signOut();
		window.location.reload();
	};

	return (
		<div
			className={`flex flex-col mt-10 bg-[#111111]/10 border border-white/10 text-gray-100 p-4 m-4 mr-0 rounded-xl transition-all duration-300 ease-in-out ${
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
								className="flex items-center justify-start space-x-3 p-2 rounded-lg hover:bg-neutral-700 transition-colors duration-200"
							>
								{icons[item.icon as keyof typeof icons]}
								{isExpanded && <span>{item.label}</span>}
							</Link>
						</li>
					))}
				</ul>
			</nav>
			<div className="mt-auto flex flex-col gap-2">
				{!isExpanded && info && (
					<Link
						to="/convert"
						className={`p-2 ${isExpanded ? "justify-start items-start" : "justify-center items-center"} flex m-auto rounded-full bg-gradient-to-t from-transparent to-[#00AA68]/40 hover:saturate-200 slow transition-colors duration-200`}	
						aria-label="Convert"
					>
						{icons.Converting}
					</Link>
				)}
				<div
					className={`flex items-center ${isExpanded ? "justify-start" : "justify-center flex-col"} gap-2 mb-4`}
				>
					<button
						type="button"
						className={`flex gap-2 items-center ${isExpanded ? "px-4 w-full text-center justify-center " : ""} p-2 rounded-full bg-[#111111]/20 hover:bg-[#111111]/40 transition-colors duration-200`}
						onClick={handleClick}
						aria-label={isExpanded ? "Collapse sidebar" : "Expand sidebar"}
					>
						{isExpanded ? icons.ArrowLeft : icons.ArrowRight} 
						{isExpanded && <span className="text-sm text-neutral-300">Collapse</span>}
					</button>
					{isExpanded && info && (
						<Link
							to="/convert"
							className={`p-2 ${isExpanded ? "justify-start items-start" : "justify-center items-center"} flex m-auto rounded-full bg-gradient-to-t from-transparent to-[#00AA68]/40 hover:saturate-200 slow transition-colors duration-200`}	
							aria-label="Convert"
						>
							{icons.Converting}
						</Link>
					)}
					{!isExpanded && userInfo && (
					<img
						src={userInfo.avatar_url}
						alt="User avatar"
						className="w-9 h-9 rounded-full border border-white/10"  
					/>
					)}
				</div>
				{isExpanded && (
					<>
					{userInfo ? (
					<div className="flex items-center space-x-3 px-4 py-3 bg-[#111111]/20 rounded-lg" onClick={logout}>
						<img
							src={userInfo.avatar_url}
							alt="User avatar"
							className="w-10 h-10 rounded-full"
						/>
						<div className="flex-1 truncate">
							<p className="font-semibold title">{userInfo.full_name}</p>
							<p className="text-sm text-gray-400">@{userInfo.discord_username || userInfo.full_name}</p>
						</div>
					</div>
					): (
						<Link to="/login" className="w-full h-full rounded-xl bg-neutral-700 py-2 flex flex-col justify-center items-center hover:bg-neutral-600 transition-colors duration-200">
						Login
						</Link>
					)}
					</>
				)}
			</div>
		</div>
	);
}

