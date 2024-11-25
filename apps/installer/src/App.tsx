import type React from "react";
import { Routes, Route } from "react-router-dom";
import Home from "./pages/Home";
import Titlebar from "./components/titlebar";
import { useEffect, useRef, useState } from "react";
import { Howl } from "howler";
import Background from "./components/background";
import SelectPath from "./pages/Select-Path";
import Install from "./pages/Install";

const App: React.FC = () => {
  const [isPlaying, setIsPlaying] = useState<boolean>(true);
  const [currentPosition, setCurrentPosition] = useState<number>(0);
  const soundRef = useRef<Howl | null>(null);

  useEffect(() => {
    soundRef.current = new Howl({
      src: ['/app.mp3'],
      volume: 0.1,
      loop: true,
      autoplay: true
    });

    return () => {
      soundRef.current?.stop();
    };
  }, []);

  const playAudio = () => {
    if (soundRef.current) {
      soundRef.current.seek(currentPosition);
      soundRef.current.play();
      soundRef.current.volume(0.1);
      setIsPlaying(true);
      console.log("audio playing");
    }
  };

  const stopAudio = () => {
    if (soundRef.current) {
      const position = soundRef.current.seek() as number;
      setCurrentPosition(position);
      soundRef.current.stop();
      setIsPlaying(false);
      console.log("audio stopped at position:", position);
    }
  };

  const handleAudio = () => {
    if (isPlaying) {
      stopAudio();
    } else {
      playAudio();
    }
  };

  return (
    <div className="bg-[#1c1c1c]/70 w-screen h-screen">
      <Titlebar />
      <Background />
      <div className="absolute w-screen h-screen">
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/select-path" element={<SelectPath />} />
        <Route path="/install" element={<Install />} />
      </Routes>
      </div>
      <div className="absolute bottom-4 right-4 flex items-center gap-2">
        <button
          onClick={handleAudio}
          type="button"
          className="slow hover:text-white"
        >
          {isPlaying ? (
            <svg
              xmlns="http://www.w3.org/2000/svg"
              viewBox="0 0 24 24"
              fill="#ffffff"
              className="w-5 h-5"
              aria-hidden="true"
            >
              <path
                fillRule="evenodd"
                d="M6.75 5.25a.75.75 0 01.75-.75H9a.75.75 0 01.75.75v13.5a.75.75 0 01-.75.75H7.5a.75.75 0 01-.75-.75V5.25zm7.5 0A.75.75 0 0115 4.5h1.5a.75.75 0 01.75.75v13.5a.75.75 0 01-.75.75H15a.75.75 0 01-.75-.75V5.25z"
                clipRule="evenodd"
              />
            </svg>
          ) : (
            <svg
              xmlns="http://www.w3.org/2000/svg"
              viewBox="0 0 24 24"
              fill="#ffffff"
              className="w-5 h-5"
              aria-hidden="true"
            >
              <path
                fillRule="evenodd"
                d="M4.5 5.653c0-1.426 1.529-2.33 2.779-1.643l11.54 6.348c1.295.712 1.295 2.573 0 3.285L7.28 19.991c-1.25.687-2.779-.217-2.779-1.643V5.653z"
                clipRule="evenodd"
              />
            </svg>
          )}
        </button>
      </div>
    </div>
  );
};

export default App;
