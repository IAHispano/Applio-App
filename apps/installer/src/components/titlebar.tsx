import { window } from "@tauri-apps/api"

export default function Titlebar() {

  const close = async () => {
    await window.getCurrentWindow().close()
  }

  return (
    <div className="absolute top-0 right-0 select-none overflow-hidden p-2 pt-3 w-full z-50 bg-gradient-to-b from-[#1c1c1c]/50 to-transparent" data-tauri-drag-region>
    <div className="flex justify-between items-center m-auto px-2" data-tauri-drag-region>
    <p className="text-xs text-neutral-400 title font-medium"><span className="font-semibold">Applio App</span> | Installer</p>
    <button
        onClick={close}
        type="button"
        className="slow hover:text-white"
    >
        <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 24 24"
            width={18}
            height={18}
            fill={"none"}
            aria-hidden="true"
        >
            <path
                d="M19.0005 4.99988L5.00045 18.9999M5.00045 4.99988L19.0005 18.9999"
                stroke="#ffffffa3"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
            />
        </svg>
    </button>
    </div>
    </div>
  )
}