import { invoke } from "@tauri-apps/api/core"
import { useEffect, useState } from "react"
import { useNavigate } from "react-router-dom"
import { motion } from "motion/react"

export default function SelectPath() {
    const [value, setValue] = useState("")
    const navigate = useNavigate()

    useEffect(() => {
        const getActualDir = async () => {
            const dir = await invoke('get_actual_dir')
            setValue(dir as string)
        }

        getActualDir()
    }, [])

  return (
   <motion.main initial={{opacity: 0}} animate={{opacity: 1}} transition={{duration: 1}} className="flex justify-center items-center p-4 w-full h-full m-auto">
    <div className="w-full h-full flex flex-col  max-w-2xl mt-auto justify-end pb-24 text-neutral-300 gap-2">
        <h1 className="text-xl title font-semibold">Install in:</h1>
        <input value={value} placeholder="Loading..." readOnly className="cursor-default appearance-none rounded-lg px-4 py-1 bg-neutral-800/60 text-sm text-neutral-300 focus:outline-none"/>
        <button onClick={() => navigate('/install')} type='button' className='ml-auto px-6 py-1 bg-white/10 text-neutral-300 text-sm w-fit rounded-xl hover:bg-white/20 transition-all duration-400'>
              Next
        </button>
    </div>
   </motion.main>
  )
}