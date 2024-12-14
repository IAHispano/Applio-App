"use client"

import { useState, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Store } from '@tauri-apps/plugin-store'
import { open } from '@tauri-apps/plugin-shell'

export default function AnimatedApplio() {
  const [position, setPosition] = useState('center')
  const [showReleaseNotes, setShowReleaseNotes] = useState(false)
  const [backgroundColor, setBackgroundColor] = useState("#111111")

  useEffect(() => {
	const getColor = async () => {
		const store = await Store.load("settings.json");
		const color = await store.get("backgroundColor");

		if (color) {
			function rgbaToHex(rgba: string) {
				const parts = rgba.match(/(\d+), (\d+), (\d+), (\d+(\.\d+)?)/);
				if (!parts) return "#2a2b2a";

				const r = Number.parseInt(parts[1]);
				const g = Number.parseInt(parts[2]);
				const b = Number.parseInt(parts[3]);

				const hex = `#${((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1)}`;
				return hex;
			}

			setBackgroundColor(rgbaToHex(color as string));
		}
	};

	getColor();
}, []);

  useEffect(() => {
    const centerTimer = setTimeout(() => {
      setPosition('topLeft')
    }, 2000)

    const releaseNotesTimer = setTimeout(() => {
      setShowReleaseNotes(true)
    }, 3000)

    return () => {
      clearTimeout(centerTimer)
      clearTimeout(releaseNotesTimer)
    }
  }, [])

  const variants = {
    center: { 
      fontSize: "100px", 
      left: "50%", 
      top: "49%", 
      x: "-50%", 
      y: "-50%" 
    },
    topLeft: { 
      fontSize: "60px", 
      left: "50%", 
      top: "10%", 
      x: "-50%", 
      y: "-50%" 
    }
  }

  return (
    <div className="grid h-screen w-screen overflow-hidden">
      <main className="flex flex-col items-center justify-start mt-10 mb-4 px-4 w-full overflow-hidden">
        <div className="w-full h-full flex flex-col gap-4 overflow-hidden">
          <div className="grid grid-cols-3 grid-rows-3 gap-4 w-full h-full">
            <div
              className="w-full h-full rounded-xl noise row-span-3 col-span-3 flex flex-col justify-start items-start relative"
              style={{
                background: `radial-gradient(150% 150% at 50% 10%, #111111A3 40%, ${backgroundColor} 100%)`,
              }}
            >
              <motion.h1
                variants={variants}
                initial="center"
                animate={position}
                transition={{ 
                  duration: 1,
                  ease: "easeInOut"
                }}
                className="font-bold title absolute"
              >
                Applio
              </motion.h1>
              <AnimatePresence>
                {showReleaseNotes && (
                  <motion.div
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -20 }}
                    transition={{ duration: 0.5 }}
                    className="absolute top-24 left-5 right-4"
                  >
					<div className='grid grid-cols-3 gap-6 w-full h-full mt-12 overflow-hidden'>
					<div className='border border-white/10 rounded-xl p-4 h-screen w-full overflow-hidden'>
                    <h2 className="text-2xl font-semibold title text-neutral-200">How to start?</h2>
					<div className='mb-4 mt-2 border border-white/10 border-t'/>
                    <ul className="list-disc pl-5 space-y-4">
						<li>
						<h3 className='text-neutral-300 font-semibold'>Check the documentation</h3>
						<p className='text-neutral-400 text-xs'>We have put a lot of effort into creating a complete documentation for Applio App, so don't forget to check it out! You will find from basic concepts to advanced guides. Access it by <span className='cursor-pointer text-neutral-300 underline hover:text-neutral-200 slow' onClick={() => open("https://docs.applio.org")}>clicking here</span>.</p>
						</li>
						<li>
						<h3 className='text-neutral-300 font-semibold'>Explore the interface</h3>
						<p className='text-neutral-400 text-xs'>The interface has been designed to make it easy for anyone to use the application. Explore its functions, discover all it has to offer and learn how to get the most out of it - there is so much to do and enjoy!</p>
						</li>
						<li>
						<h3 className='text-neutral-300 font-semibold'>Need more help?</h3>
						<p className='text-neutral-400 text-xs'>We are here to help you! If you have any questions or need support, please feel free to join <span className='cursor-pointer text-neutral-300 underline hover:text-neutral-200 slow' onClick={() => open("https://applio.org/discord")}>our Discord server</span>. We'll be happy to assist you!</p>
						</li>
                    </ul>
					</div>
					<div className='border border-white/10 rounded-xl p-4 h-screen w-full overflow-hidden'>
                    <h2 className="text-2xl font-semibold title text-neutral-200">How to start?</h2>
					<div className='mb-4 mt-2 border border-white/10 border-t'/>
                    <ul className="list-disc pl-5 space-y-4">
						<li>
						<h3 className='text-neutral-300 font-semibold'>Check the documentation</h3>
						<p className='text-neutral-400 text-xs'>We have put a lot of effort into creating a complete documentation for Applio App, so don't forget to check it out! You will find from basic concepts to advanced guides. Access it by <span className='cursor-pointer text-neutral-300 underline hover:text-neutral-200 slow' onClick={() => open("https://docs.applio.org")}>clicking here</span>.</p>
						</li>
						<li>
						<h3 className='text-neutral-300 font-semibold'>Explore the interface</h3>
						<p className='text-neutral-400 text-xs'>The interface has been designed to make it easy for anyone to use the application. Explore its functions, discover all it has to offer and learn how to get the most out of it - there is so much to do and enjoy!</p>
						</li>
						<li>
						<h3 className='text-neutral-300 font-semibold'>Need more help?</h3>
						<p className='text-neutral-400 text-xs'>We are here to help you! If you have any questions or need support, please feel free to join <span className='cursor-pointer text-neutral-300 underline hover:text-neutral-200 slow' onClick={() => open("https://applio.org/discord")}>our Discord server</span>. We'll be happy to assist you!</p>
						</li>
                    </ul>
					</div>
					<div className='border border-white/10 rounded-xl p-4 h-screen w-full overflow-hidden'>
                    <h2 className="text-2xl font-semibold title text-neutral-200">Send feedback</h2>
					<div className='mb-4 mt-2 border border-white/10 border-t'/>
                    <ul className="list-disc pl-5 space-y-4">
						<li>
						<h3 className='text-neutral-300 font-semibold'>Comments</h3>
						<p className='text-neutral-400 text-xs'>We love to receive your feedback, whether it's positive, negative or even the most unexpected! To make it easier for you to share your opinion without interruptions, we have created a form with some specific questions. At the end, you will have the option to add any additional comments you wish - your opinion is very valuable to us! Access the questionnaire by <span className='cursor-pointer text-neutral-300 underline hover:text-neutral-200 slow' onClick={() => open("https://forms.gle/XBUoE6j6KZ3iwFH67")}>clicking here</span>.</p>
						</li>
						<li>
						<h3 className='text-neutral-300 font-semibold'>Bugs</h3>
						<p className='text-neutral-400 text-xs'>Bugs can be frustrating and negatively affect the user experience. At Applio App, we want to dedicate all our efforts to fix them so you can enjoy the best possible experience. That's why we've created a dedicated channel on our Discord server where you can report bugs or share any bad experiences you've had with the app - <span className='cursor-pointer text-neutral-300 underline hover:text-neutral-200 slow' onClick={() => open("https://applio.org/discord")}>join us on Discord</span>, tell us what happened, and we'll get to work as soon as possible!</p>
						</li>
						<li>
						<h3 className='text-neutral-300 font-semibold'>Errors</h3>
						<p className='text-neutral-400 text-xs'>Errors are inevitable, but we want to fix them as soon as possible. If you find one in Applio App, join <span className='cursor-pointer text-neutral-300 underline hover:text-neutral-200 slow' onClick={() => open("https://applio.org/discord")}>our Discord server</span> and report it in the corresponding channel or contact the technical team directly - your help is essential to improve!</p>

						</li>
                    </ul>
					</div>
					</div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </div>
        </div>
      </main>	
    </div>
  )
}

