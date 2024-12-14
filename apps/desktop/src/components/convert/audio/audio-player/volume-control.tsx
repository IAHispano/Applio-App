import React from 'react';
import { Volume2, VolumeX } from 'lucide-react';

interface VolumeControlProps {
  volume: number;
  isMuted: boolean;
  onVolumeChange: (value: number) => void;
  onToggleMute: () => void;
}

const VolumeControl: React.FC<VolumeControlProps> = ({
  volume,
  isMuted,
  onVolumeChange,
  onToggleMute,
}) => (
  <div className="flex items-center space-x-2 max-w-[200px] ml-4">
    <button
      onClick={onToggleMute}
      className="p-2 text-neutral-400 hover:text-neutral-200"
      aria-label={isMuted ? 'Unmute' : 'Mute'}
    >
      {isMuted ? (
        <VolumeX className="w-5 h-5" />
      ) : (
        <Volume2 className="w-5 h-5" />
      )}
    </button>
    <input
      type="range"
      min={0}
      max={1}
      step={0.1}
      value={isMuted ? 0 : volume}
      onChange={(e) => onVolumeChange(parseFloat(e.target.value))}
      className="w-full h-2 bg-white/10 rounded-lg appearance-none cursor-pointer accent-white"
      aria-label="Volume"
    />
  </div>
);

export default VolumeControl;