"use client";

import { motion } from "framer-motion";

export default function Background0() {
	return (
		<motion.div
			className="absolute inset-0 w-screen h-screen z-0 overflow-hidden"
			style={{ zIndex: -1 }}
			initial={{ opacity: 0, filter: "blur(0px)" }}
			animate={{ opacity: 0.15, filter: "blur(40px)" }}
			transition={{ duration: 0.8 }}
		>
			<div
				style={{
					background:
						"radial-gradient(0% 100% at 0% 0%, #111111, #00AA68 100%)",
				}}
				className="w-full h-full brightness-75"
			/>
			<svg
				xmlns="http://www.w3.org/2000/svg"
				className="w-full h-full absolute inset-0"
				viewBox="0 0 1822 1023"
				fill="none"
				aria-hidden="true"
			>
				<g opacity="0.5">
					<path d="M1 1023L1 -2.05338e-05" stroke="white" strokeOpacity="0.1" />
					<path
						d="M261 1023L261 -2.05338e-05"
						stroke="white"
						strokeOpacity="0.1"
					/>
					<path
						d="M521 1023L521 -2.05338e-05"
						stroke="white"
						strokeOpacity="0.1"
					/>
					<path
						d="M781 1023L781 -2.05338e-05"
						stroke="white"
						strokeOpacity="0.1"
					/>
					<path
						d="M1041 1023V-2.05338e-05"
						stroke="white"
						strokeOpacity="0.1"
					/>
					<path
						d="M1301 1023V-2.05338e-05"
						stroke="white"
						strokeOpacity="0.1"
					/>
					<path
						d="M1561 1023V-2.05338e-05"
						stroke="white"
						strokeOpacity="0.1"
					/>
					<path
						d="M1821 1023V-2.05338e-05"
						stroke="white"
						strokeOpacity="0.1"
					/>
				</g>
			</svg>
		</motion.div>
	);
}
