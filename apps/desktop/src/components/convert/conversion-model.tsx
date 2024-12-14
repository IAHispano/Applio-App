'use client'

import { useEffect, useRef, useState } from "react"
import { useConvertContext } from "./conversion-context"
import Loading from "./loading"
import { ModelType } from "./models/types"
import { invoke } from "@tauri-apps/api/core"
import { ChevronDown } from 'lucide-react'

export default function ConversionModel() {
  const {
    models,
    setModels,
    currentModel,
    setCurrentModel,
    setModelName,
    setPth,
    setIndex,
    pth, 
    index
  } = useConvertContext()
  
  const [loading, setLoading] = useState(true)
  const [isOpen, setIsOpen] = useState(false)
  const dropdownRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    async function getLocalModels() {
      try {
        const port = await invoke<number>("get_port")
        const response = await fetch(`http://localhost:${port}/get-models`)
        if (response.ok) {
          const fetchedModels: ModelType[] = await response.json()
          setModels(fetchedModels)
          setLoading(false)
        } else {
          console.error("Error fetching models:", response.statusText)
          setLoading(false)
        }
      } catch (error) {
        console.error("Fetch error:", error)
        setLoading(false)
      }
    }

    getLocalModels()
  }, [setModels])

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false)
      }
    }

    document.addEventListener("mousedown", handleClickOutside)
    return () => {
      document.removeEventListener("mousedown", handleClickOutside)
    }
  }, [])

  useEffect(() => {
    if (currentModel) {
      setModelName(currentModel.name);
      setPth(currentModel.model_pth_file);
      setIndex(currentModel.model_index_file);
      setIsOpen(false);
    }
  }, [currentModel]);
  
  useEffect(() => {
    if (pth && index) {
      console.log("index y pth ", pth, index);
    }
  }, [pth, index]);
  

  const toggleDropdown = () => {
    setIsOpen(!isOpen);
    setModelName("");
  }

  return (
    <div className="relative rounded-xl row-span-2 w-full h-14" ref={dropdownRef}>
      <div
        className="absolute w-full h-full rounded-xl border border-white/10"
      />
      {loading ? (
        <div className="w-full h-full flex justify-center items-center">
          <Loading />
        </div>
      ) : (
        <>
        <div className="w-full h-full flex flex-col py-2 relative">
          <div
            className="w-full h-full flex items-center justify-between px-4 cursor-pointer z-10"
            onClick={toggleDropdown}
          >
            <span className="text-neutral-300 truncate">
              {currentModel ? decodeURIComponent(currentModel.name) : "Select a model"}
            </span>
            <ChevronDown className="text-neutral-300" />
          </div>
          {isOpen && (
            <div className="absolute top-full left-0 w-full mt-2 bg-neutral-600 rounded-xl z-20 max-h-60 overflow-y-auto text-sm p-3 gap-2 flex flex-col">
              {models.length > 0 ? (
                models.map((model) => (
                  <div
                    key={model.name}
                    className="px-4 py-2 hover:bg-white/10 slow cursor-pointer text-neutral-300 rounded-xl border border-white/10"
                    onClick={() => setCurrentModel(model)}
                  >
                    {decodeURIComponent(model.name)}
                  </div>
                ))
              ) : (
                <div className="px-4 py-2 text-neutral-300">
                  No models found
                </div>
              )}
            </div>
          )}
        </div>
        </>
      )}
    </div>
  )
}

