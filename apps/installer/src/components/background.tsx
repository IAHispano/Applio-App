import type React from "react";
import { useEffect, useRef } from "react";
import { motion } from "motion/react";

const Background: React.FC = () => {
	const canvasRef = useRef<HTMLCanvasElement>(null);

	useEffect(() => {
		const canvas = canvasRef.current;
		if (!canvas) return;

		const ctx = canvas.getContext("2d");
		if (!ctx) return;

		let animationFrameId: number;

		const resizeCanvas = () => {
			canvas.width = window.innerWidth;
			canvas.height = window.innerHeight;
		};

		window.addEventListener("resize", resizeCanvas);
		resizeCanvas();

		const colors = ["#0f5038", "#123729", "#181b18", "#161817"];
		const blobs: Blob[] = [];

		class Blob {
			x: number;
			y: number;
			radius: number;
			color: string;
			vx: number;
			vy: number;

			constructor() {
				this.x = canvas ? Math.random() * canvas.width : 0;
				this.y = canvas ? Math.random() * canvas.height : 0;
				this.radius = Math.random() * 200 + 100;
				this.color = colors[Math.floor(Math.random() * colors.length)];
				this.vx = Math.random() * 2 - 1;
				this.vy = Math.random() * 2 - 1;
			}

			update() {
				this.x += this.vx;
				this.y += this.vy;

				if (canvas && (this.x < 0 || this.x > canvas.width)) this.vx *= -1;
				if (canvas && (this.y < 0 || this.y > canvas.height)) this.vy *= -1;
			}

			draw() {
				if (!ctx) return;
				ctx.beginPath();
				ctx.arc(this.x, this.y, this.radius, 0, Math.PI * 2);
				ctx.fillStyle = this.color;
				ctx.fill();
			}
		}

		for (let i = 0; i < 5; i++) {
			blobs.push(new Blob());
		}

		const animate = () => {
			if (!ctx) return;
			ctx.clearRect(0, 0, canvas.width, canvas.height);

			blobs.forEach((blob) => {
				blob.update();
				blob.draw();
			});

			ctx.globalCompositeOperation = "screen";

			animationFrameId = requestAnimationFrame(animate);
		};

		animate();

		return () => {
			window.removeEventListener("resize", resizeCanvas);
			cancelAnimationFrame(animationFrameId);
		};
	}, []);

	return (
		<motion.div
			initial={{ opacity: 0 }}
			animate={{ opacity: 1 }}
			transition={{ duration: 3, delay: 2 }}
			className="absolute w-full h-full overflow-hidden"
		>
			<canvas
				ref={canvasRef}
				className="absolute inset-0 w-full h-full"
				style={{ filter: "blur(80px)" }}
			/>
		</motion.div>
	);
};

export default Background;
