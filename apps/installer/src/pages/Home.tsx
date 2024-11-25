import { useNavigate } from 'react-router-dom'
import { motion } from 'motion/react'

export default function Home() {
  const navigate = useNavigate();

  return (
    <main className="min-h-screen min-w-screen overflow-hidden">
      <div className="w-screen h-screen overflow-hidden relative">    
        <div className="absolute inset-0 flex items-center justify-center">
            <motion.div initial={{ opacity: 0, marginBottom: 0 }} animate={{ opacity: 1, marginBottom: 48 }} transition={{ duration: 1.8, delay: 4 }} className='flex flex-col justify-center items-center gap-4'>
            <h1 className='text-neutral-200 text-6xl font-semibold title'>Applio App</h1>
            </motion.div>
        </div>
      </div>
      <div className='absolute bottom-3 right-14 flex flex-col items-center group'>
        <button 
          onClick={() => navigate('/select-path')} 
          type='button' 
          className='px-6 py-1 bg-[#1c1c1c]/50 border border-white/10 text-neutral-300 text-sm w-fit rounded-xl hover:bg-[#1c1c1c]/30 transition-all duration-400'>
            Next
        </button>
        <p className='text-neutral-400 text-xs absolute text-balance text-end bottom-10 right-1 opacity-0 group-hover:opacity-100 transition-opacity duration-300'>
          Go to next page
        </p>
      </div>
    </main>
  )
}

